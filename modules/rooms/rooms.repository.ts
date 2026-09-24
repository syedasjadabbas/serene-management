import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Room status data access: rooms, room_status_history, room_service_blocks,
 * and the room board read model (which joins stays, today's arrivals, open
 * housekeeping tasks and open maintenance requests). Every query is scoped
 * by property.
 */

const liveBlock = (roomAlias: Prisma.Sql, kind: "OUT_OF_ORDER" | "OUT_OF_SERVICE", on: string) =>
  Prisma.sql`EXISTS (
    SELECT 1 FROM "room_service_blocks" b
    WHERE b."room_id" = ${roomAlias}."id" AND b."kind" = ${kind}::"service_block_kind"
      AND b."status" IN ('SCHEDULED', 'ACTIVE')
      AND b."from_date" <= ${on}::date AND b."to_date" > ${on}::date)`;

export interface LockedRoomRow {
  id: string;
  number: string;
  room_type_id: string;
  status: string;
  housekeeping_status: string;
  front_office_status: string;
  service_status: string;
  version: number;
  out_of_order: boolean;
  out_of_service: boolean;
}

/**
 * Row-locks rooms in id order (deterministic, so two commands touching the
 * same rooms queue instead of deadlocking) and reports the service blocks
 * covering the business date.
 */
export function lockRooms(tx: Tx, propertyId: string, ids: string[], businessDate: string) {
  const sorted = [...new Set(ids)].sort();
  return tx.$queryRaw<LockedRoomRow[]>`
    SELECT r."id", r."number", r."room_type_id", r."status"::text AS "status",
           r."housekeeping_status"::text AS "housekeeping_status",
           r."front_office_status"::text AS "front_office_status",
           r."service_status"::text AS "service_status", r."version",
           ${liveBlock(Prisma.sql`r`, "OUT_OF_ORDER", businessDate)} AS "out_of_order",
           ${liveBlock(Prisma.sql`r`, "OUT_OF_SERVICE", businessDate)} AS "out_of_service"
    FROM "rooms" r
    WHERE r."property_id" = ${propertyId}::uuid AND r."id" = ANY(${sorted}::uuid[])
    ORDER BY r."id"
    FOR UPDATE OF r`;
}

export function updateRoomStatusVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.RoomUncheckedUpdateManyInput,
) {
  return tx.room.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 }, statusChangedAt: new Date() },
  });
}

export function insertStatusHistory(tx: Tx, rows: Prisma.RoomStatusHistoryCreateManyInput[]) {
  return tx.roomStatusHistory.createMany({ data: rows });
}

export function findStatusHistory(tx: Tx, propertyId: string, roomIds: string[], take: number) {
  return tx.roomStatusHistory.findMany({
    where: { propertyId, roomId: { in: roomIds } },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      roomId: true,
      field: true,
      fromValue: true,
      toValue: true,
      businessDate: true,
      source: true,
      reason: true,
      changedById: true,
      createdAt: true,
      room: { select: { number: true } },
    },
  });
}

// --- Service blocks (out of order / out of service) --------------------------------------

export function findRoomRef(tx: Tx, propertyId: string, id: string) {
  return tx.room.findFirst({
    where: { id, propertyId },
    select: { id: true, number: true, roomTypeId: true, status: true },
  });
}

export function findServiceReasonCode(
  tx: Tx,
  propertyId: string,
  id: string,
  category: "OUT_OF_ORDER" | "OUT_OF_SERVICE",
) {
  return tx.reasonCode.findFirst({
    where: { id, propertyId, category, status: "ACTIVE" },
    select: { id: true, code: true, name: true },
  });
}

export function findServiceReasonCodes(tx: Tx, propertyId: string) {
  return tx.reasonCode.findMany({
    where: { propertyId, status: "ACTIVE", category: { in: ["OUT_OF_ORDER", "OUT_OF_SERVICE"] } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, category: true },
  });
}

/** Live (scheduled or active) blocks of a room overlapping [from, to). */
export function findOverlappingBlocks(tx: Tx, roomId: string, from: Date, to: Date) {
  return tx.roomServiceBlock.findMany({
    where: {
      roomId,
      status: { in: ["SCHEDULED", "ACTIVE"] },
      fromDate: { lt: to },
      toDate: { gt: from },
    },
    select: { id: true, kind: true, fromDate: true, toDate: true },
  });
}

/** Active assignments of the room overlapping [from, to), with the booking they belong to. */
export function findOverlappingAssignments(tx: Tx, roomId: string, from: Date, to: Date) {
  return tx.roomAssignment.findMany({
    where: { roomId, status: "ACTIVE", fromDate: { lt: to }, toDate: { gt: from } },
    select: {
      fromDate: true,
      toDate: true,
      reservationRoom: {
        select: { status: true, reservation: { select: { confirmationNumber: true } } },
      },
    },
    take: 20,
  });
}

export function countInHouseStays(tx: Tx, propertyId: string, roomId: string) {
  return tx.stay.count({ where: { propertyId, roomId, status: "IN_HOUSE" } });
}

export function insertServiceBlock(tx: Tx, data: Prisma.RoomServiceBlockUncheckedCreateInput) {
  return tx.roomServiceBlock.create({ data, select: { id: true } });
}

export interface LockedBlockRow {
  id: string;
  room_id: string;
  kind: "OUT_OF_ORDER" | "OUT_OF_SERVICE";
  status: string;
  from_date: Date;
  to_date: Date;
  return_status: string;
  maintenance_request_id: string | null;
}

export async function lockServiceBlock(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<LockedBlockRow[]>`
    SELECT "id", "room_id", "kind"::text AS "kind", "status"::text AS "status", "from_date",
           "to_date", "return_status"::text AS "return_status", "maintenance_request_id"
    FROM "room_service_blocks"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

export function findLiveBlockIds(tx: Tx, propertyId: string, maintenanceRequestId: string) {
  return tx.roomServiceBlock.findMany({
    where: { propertyId, maintenanceRequestId, status: { in: ["SCHEDULED", "ACTIVE"] } },
    select: { id: true },
  });
}

export function releaseBlockRow(tx: Tx, id: string, userId: string) {
  return tx.roomServiceBlock.update({
    where: { id },
    data: { status: "RELEASED", releasedAt: new Date(), releasedById: userId },
    select: { id: true },
  });
}

export function findRoomDetail(tx: Tx, propertyId: string, id: string) {
  return tx.room.findFirst({
    where: { id, propertyId },
    select: {
      id: true,
      number: true,
      description: true,
      status: true,
      housekeepingStatus: true,
      frontOfficeStatus: true,
      serviceStatus: true,
      version: true,
      isAccessible: true,
      isSmoking: true,
      roomType: { select: { id: true, code: true, name: true } },
      floor: { select: { id: true, name: true } },
      roomServiceBlocks: {
        where: { status: { in: ["SCHEDULED", "ACTIVE"] } },
        orderBy: { fromDate: "asc" },
        select: {
          id: true,
          kind: true,
          status: true,
          fromDate: true,
          toDate: true,
          notes: true,
          maintenanceRequestId: true,
          createdAt: true,
          reasonCode: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
}

// --- Room board read model ------------------------------------------------------------------

export interface RoomBoardSqlRow {
  id: string;
  number: string;
  floor_id: string | null;
  floor: string | null;
  room_type_id: string;
  room_type_code: string;
  housekeeping_status: string;
  front_office_status: string;
  version: number;
  block_id: string | null;
  block_kind: "OUT_OF_ORDER" | "OUT_OF_SERVICE" | null;
  block_until: Date | null;
  block_reason: string | null;
  stay_id: string | null;
  stay_guest: string | null;
  stay_vip: string | null;
  stay_departure: Date | null;
  arriving_reservation_room_id: string | null;
  arriving_reservation_id: string | null;
  arriving_guest: string | null;
  arriving_vip: string | null;
  arriving_eta: string | null;
  task_id: string | null;
  task_status: string | null;
  task_priority: number | null;
  task_type_code: string | null;
  task_attendant: string | null;
  open_maintenance: number;
  maintenance_rank: number | null;
}

/**
 * Every active room with occupancy, housekeeping and service status for the
 * business date, the guest in house, today's assigned arrival, the current
 * housekeeping task and open maintenance. Bounded by the property's room
 * count; laterals use the (property, room) indexes.
 */
export function findRoomBoard(
  tx: Tx,
  propertyId: string,
  businessDate: string,
  filters: { roomTypeId: string | null; floorId: string | null },
) {
  return tx.$queryRaw<RoomBoardSqlRow[]>`
    SELECT r."id", r."number", f."id" AS "floor_id", f."name" AS "floor",
           rt."id" AS "room_type_id", rt."code" AS "room_type_code",
           r."housekeeping_status"::text AS "housekeeping_status",
           r."front_office_status"::text AS "front_office_status", r."version",
           blk."id" AS "block_id", blk."kind"::text AS "block_kind", blk."to_date" AS "block_until",
           rc."name" AS "block_reason",
           ih."stay_id", ih."guest" AS "stay_guest", ih."vip" AS "stay_vip",
           ih."departure_date" AS "stay_departure",
           arr."id" AS "arriving_reservation_room_id", arr."reservation_id" AS "arriving_reservation_id",
           arr."guest" AS "arriving_guest", arr."vip" AS "arriving_vip", arr."eta" AS "arriving_eta",
           task."id" AS "task_id", task."status"::text AS "task_status", task."priority" AS "task_priority",
           tt."code" AS "task_type_code", att."name" AS "task_attendant",
           mnt."open_count" AS "open_maintenance", mnt."top_rank" AS "maintenance_rank"
    FROM "rooms" r
    JOIN "room_types" rt ON rt."id" = r."room_type_id"
    LEFT JOIN "floors" f ON f."id" = r."floor_id"
    LEFT JOIN LATERAL (
      SELECT b."id", b."kind", b."to_date", b."reason_code_id" FROM "room_service_blocks" b
      WHERE b."room_id" = r."id" AND b."status" IN ('SCHEDULED', 'ACTIVE')
        AND b."from_date" <= ${businessDate}::date AND b."to_date" > ${businessDate}::date
      LIMIT 1) blk ON TRUE
    LEFT JOIN "reason_codes" rc ON rc."id" = blk."reason_code_id"
    LEFT JOIN LATERAL (
      SELECT s."id" AS "stay_id", rr."departure_date", v."code" AS "vip",
             concat_ws(', ', g."last_name", g."first_name") AS "guest"
      FROM "stays" s
      JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
      JOIN "guests" g ON g."id" = s."primary_guest_id"
      LEFT JOIN "vip_levels" v ON v."id" = g."vip_level_id"
      WHERE s."property_id" = r."property_id" AND s."room_id" = r."id" AND s."status" = 'IN_HOUSE'
      LIMIT 1) ih ON TRUE
    LEFT JOIN LATERAL (
      SELECT rr."id", rr."reservation_id", rr."eta", v."code" AS "vip",
             concat_ws(', ', g."last_name", g."first_name") AS "guest"
      FROM "reservation_rooms" rr
      JOIN "guests" g ON g."id" = rr."primary_guest_id"
      LEFT JOIN "vip_levels" v ON v."id" = g."vip_level_id"
      WHERE rr."property_id" = r."property_id" AND rr."room_id" = r."id"
        AND rr."status" = 'RESERVED' AND rr."arrival_date" = ${businessDate}::date
      ORDER BY rr."id" LIMIT 1) arr ON TRUE
    LEFT JOIN LATERAL (
      SELECT t."id", t."status", t."priority", t."task_type_id", t."attendant_id"
      FROM "housekeeping_tasks" t
      WHERE t."property_id" = r."property_id" AND t."room_id" = r."id"
        AND (t."status" IN ('PENDING', 'IN_PROGRESS', 'PAUSED', 'FAILED_INSPECTION')
             OR (t."status" = 'COMPLETED' AND t."business_date" = ${businessDate}::date))
      ORDER BY (t."status" = 'COMPLETED'), t."priority", t."created_at" LIMIT 1) task ON TRUE
    LEFT JOIN "housekeeping_task_types" tt ON tt."id" = task."task_type_id"
    LEFT JOIN "housekeeping_attendants" att ON att."id" = task."attendant_id"
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS "open_count",
             min(CASE m."priority" WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END)::int AS "top_rank"
      FROM "maintenance_requests" m
      WHERE m."property_id" = r."property_id" AND m."room_id" = r."id"
        AND m."status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD')) mnt ON TRUE
    WHERE r."property_id" = ${propertyId}::uuid AND r."status" = 'ACTIVE'
      ${filters.roomTypeId ? Prisma.sql`AND r."room_type_id" = ${filters.roomTypeId}::uuid` : Prisma.empty}
      ${filters.floorId ? Prisma.sql`AND r."floor_id" = ${filters.floorId}::uuid` : Prisma.empty}
    ORDER BY r."sort_order", r."number"
    LIMIT 2000`;
}

export function findBoardReferenceData(tx: Tx, propertyId: string) {
  return Promise.all([
    tx.floor.findMany({
      where: { propertyId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    tx.roomType.findMany({
      where: { propertyId, status: "ACTIVE", isPseudo: false },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
  ]);
}
