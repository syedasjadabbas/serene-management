import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Front desk data access. The front desk is part of the "Reservations &
 * front office" context (docs/DOMAIN_MODEL.md §3.6): it owns `stays` and the
 * operational read models below (arrivals, in-house, departures, room
 * board). Writes to reservation rooms and assignments go through the
 * reservations service; room status writes through the rooms service.
 * Every query is scoped by property.
 */

// --- Stays --------------------------------------------------------------------------

export function findStayRef(tx: Tx, propertyId: string, stayId: string) {
  return tx.stay.findFirst({
    where: { id: stayId, propertyId },
    select: { id: true, reservationRoomId: true },
  });
}

export interface LockedStayRow {
  id: string;
  reservation_room_id: string;
  room_id: string;
  primary_guest_id: string;
  status: "IN_HOUSE" | "CHECKED_OUT";
  version: number;
  arrival_business_date: Date;
}

/** Locks the stay FOR UPDATE (after its reservation room, per the lock order). */
export async function lockStay(tx: Tx, propertyId: string, stayId: string) {
  const rows = await tx.$queryRaw<LockedStayRow[]>`
    SELECT "id", "reservation_room_id", "room_id", "primary_guest_id", "status"::text AS "status",
           "version", "arrival_business_date"
    FROM "stays"
    WHERE "id" = ${stayId}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

export function insertStay(tx: Tx, data: Prisma.StayUncheckedCreateInput) {
  return tx.stay.create({ data, select: { id: true } });
}

export function updateStayVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.StayUncheckedUpdateManyInput,
) {
  return tx.stay.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

export function findStayDetail(tx: Tx, propertyId: string, stayId: string) {
  return tx.stay.findFirst({
    where: { id: stayId, propertyId },
    select: {
      id: true,
      status: true,
      version: true,
      checkedInAt: true,
      checkedInById: true,
      arrivalBusinessDate: true,
      checkedOutAt: true,
      checkedOutById: true,
      departureBusinessDate: true,
      room: {
        select: { id: true, number: true, housekeepingStatus: true, frontOfficeStatus: true },
      },
      primaryGuest: {
        select: {
          id: true,
          title: true,
          firstName: true,
          lastName: true,
          profileNumber: true,
          primaryEmail: true,
          primaryPhone: true,
          vipLevel: { select: { code: true } },
        },
      },
      reservationRoom: {
        select: {
          id: true,
          reservationId: true,
          lineNumber: true,
          arrivalDate: true,
          departureDate: true,
          adults: true,
          children: true,
          isWalkIn: true,
          roomType: { select: { id: true, code: true, name: true } },
          ratePlan: { select: { id: true, code: true, name: true } },
          reservation: {
            select: {
              confirmationNumber: true,
              _count: { select: { rooms: true } },
              notes: {
                where: { deletedAt: null },
                orderBy: { createdAt: "asc" },
                take: 50,
                select: { id: true, body: true, createdAt: true },
              },
            },
          },
          assignments: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              fromDate: true,
              toDate: true,
              kind: true,
              status: true,
              createdAt: true,
              assignedById: true,
              releasedAt: true,
              roomId: true,
              room: { select: { number: true } },
              reasonCode: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
  });
}

export function findReservationRoomForOptions(tx: Tx, propertyId: string, id: string) {
  return tx.reservationRoom.findFirst({
    where: { id, propertyId },
    select: {
      id: true,
      status: true,
      roomTypeId: true,
      roomId: true,
      arrivalDate: true,
      departureDate: true,
    },
  });
}

export function findOperationalReasonCodes(tx: Tx, propertyId: string) {
  return tx.reasonCode.findMany({
    where: { propertyId, status: "ACTIVE", category: { in: ["ROOM_MOVE", "EARLY_DEPARTURE"] } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, category: true },
  });
}

// --- Read models -------------------------------------------------------------------

/** Name / confirmation / room search shared by the lists (tokens are pre-normalized). */
function searchCondition(search: { tokens: string[]; raw: string } | null): Prisma.Sql {
  if (!search) return Prisma.empty;
  const nameMatch =
    search.tokens.length > 0
      ? Prisma.sql`(${Prisma.join(
          search.tokens.map((t) => Prisma.sql`g."search_name" LIKE ${`%${t}%`}`),
          " AND ",
        )})`
      : Prisma.sql`FALSE`;
  return Prisma.sql`AND (${nameMatch}
    OR res."confirmation_number" LIKE ${`${search.raw}%`}
    OR r."number" = ${search.raw})`;
}

function cursorCondition(cursor: { v: string; i: string } | null, idColumn: Prisma.Sql) {
  if (!cursor) return Prisma.empty;
  return Prisma.sql`AND (g."search_name", ${idColumn}) > (${cursor.v}, ${cursor.i}::uuid)`;
}

const blockedToday = (
  businessDate: string,
  kind: "OUT_OF_ORDER" | "OUT_OF_SERVICE",
) => Prisma.sql`EXISTS (
  SELECT 1 FROM "room_service_blocks" b
  WHERE b."room_id" = r."id" AND b."kind" = ${kind}::"service_block_kind" AND b."status" IN ('SCHEDULED', 'ACTIVE')
    AND b."from_date" <= ${businessDate}::date AND b."to_date" > ${businessDate}::date)`;

const latestNote = Prisma.sql`LEFT JOIN LATERAL (
  SELECT n."body" FROM "reservation_notes" n
  WHERE n."reservation_id" = rr."reservation_id" AND n."deleted_at" IS NULL
  ORDER BY n."created_at" DESC LIMIT 1) note ON TRUE`;

export interface ArrivalSqlRow {
  reservation_room_id: string;
  reservation_id: string;
  line_number: number;
  room_count: number;
  confirmation_number: string;
  status: string;
  version: number;
  arrival_date: Date;
  departure_date: Date;
  adults: number;
  children: number;
  eta: string | null;
  is_walk_in: boolean;
  room_type_id: string;
  room_type_code: string;
  room_type_name: string;
  reservation_type_code: string;
  deducts_inventory: boolean;
  guest_id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  search_name: string;
  vip_code: string | null;
  room_id: string | null;
  room_number: string | null;
  housekeeping_status: string | null;
  front_office_status: string | null;
  room_out_of_order: boolean;
  room_out_of_service: boolean;
  stay_id: string | null;
  latest_note: string | null;
}

export function findArrivals(
  tx: Tx,
  propertyId: string,
  businessDate: string,
  options: {
    filter: string;
    search: { tokens: string[]; raw: string } | null;
    cursor: { v: string; i: string } | null;
    limit: number;
  },
) {
  const filter = {
    all: Prisma.sql`AND rr."status" IN ('RESERVED', 'IN_HOUSE')`,
    pending: Prisma.sql`AND rr."status" = 'RESERVED'`,
    unassigned: Prisma.sql`AND rr."status" = 'RESERVED' AND rr."room_id" IS NULL`,
    assigned: Prisma.sql`AND rr."status" = 'RESERVED' AND rr."room_id" IS NOT NULL`,
    checked_in: Prisma.sql`AND rr."status" = 'IN_HOUSE'`,
    vip: Prisma.sql`AND rr."status" IN ('RESERVED', 'IN_HOUSE') AND g."vip_level_id" IS NOT NULL`,
  }[options.filter];
  return tx.$queryRaw<ArrivalSqlRow[]>`
    SELECT rr."id" AS "reservation_room_id", rr."reservation_id", rr."line_number",
           (SELECT count(*) FROM "reservation_rooms" x WHERE x."reservation_id" = rr."reservation_id")::int AS "room_count",
           res."confirmation_number", rr."status"::text AS "status", rr."version",
           rr."arrival_date", rr."departure_date", rr."adults", rr."children", rr."eta", rr."is_walk_in",
           rt."id" AS "room_type_id", rt."code" AS "room_type_code", rt."name" AS "room_type_name",
           t."code" AS "reservation_type_code", t."deducts_inventory",
           g."id" AS "guest_id", g."title", g."first_name", g."last_name", g."search_name",
           v."code" AS "vip_code",
           r."id" AS "room_id", r."number" AS "room_number",
           r."housekeeping_status"::text AS "housekeeping_status",
           r."front_office_status"::text AS "front_office_status",
           (r."id" IS NOT NULL AND ${blockedToday(businessDate, "OUT_OF_ORDER")}) AS "room_out_of_order",
           (r."id" IS NOT NULL AND ${blockedToday(businessDate, "OUT_OF_SERVICE")}) AS "room_out_of_service",
           s."id" AS "stay_id", note."body" AS "latest_note"
    FROM "reservation_rooms" rr
    JOIN "reservations" res ON res."id" = rr."reservation_id"
    JOIN "room_types" rt ON rt."id" = rr."room_type_id"
    JOIN "reservation_types" t ON t."id" = rr."reservation_type_id"
    JOIN "guests" g ON g."id" = rr."primary_guest_id"
    LEFT JOIN "vip_levels" v ON v."id" = g."vip_level_id"
    LEFT JOIN "rooms" r ON r."id" = rr."room_id"
    LEFT JOIN "stays" s ON s."reservation_room_id" = rr."id"
    ${latestNote}
    WHERE rr."property_id" = ${propertyId}::uuid
      AND rr."arrival_date" = ${businessDate}::date
      ${filter ?? Prisma.empty}
      ${searchCondition(options.search)}
      ${cursorCondition(options.cursor, Prisma.sql`rr."id"`)}
    ORDER BY g."search_name", rr."id"
    LIMIT ${options.limit + 1}`;
}

export interface StaySqlRow {
  stay_id: string;
  stay_status: "IN_HOUSE" | "CHECKED_OUT";
  stay_version: number;
  checked_in_at: Date;
  checked_out_at: Date | null;
  departure_business_date: Date | null;
  reservation_room_id: string;
  reservation_id: string;
  line_number: number;
  room_count: number;
  confirmation_number: string;
  arrival_date: Date;
  departure_date: Date;
  adults: number;
  children: number;
  room_type_id: string;
  room_type_code: string;
  room_type_name: string;
  guest_id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  search_name: string;
  vip_code: string | null;
  room_id: string;
  room_number: string;
  housekeeping_status: string;
  front_office_status: string;
  latest_note: string | null;
}

export type StayListFilter =
  | { list: "in_house"; filter: "all" | "arrived_today" | "due_out" }
  | { list: "departures"; filter: "all" | "due_out" | "departed" };

function stayListCondition(selection: StayListFilter, businessDate: string): Prisma.Sql {
  const inHouse = Prisma.sql`s."status" = 'IN_HOUSE'`;
  const dueOut = Prisma.sql`(s."status" = 'IN_HOUSE' AND rr."departure_date" <= ${businessDate}::date)`;
  const departed = Prisma.sql`(s."status" = 'CHECKED_OUT' AND s."departure_business_date" = ${businessDate}::date)`;
  if (selection.list === "in_house") {
    if (selection.filter === "arrived_today")
      return Prisma.sql`${inHouse} AND s."arrival_business_date" = ${businessDate}::date`;
    return selection.filter === "due_out" ? dueOut : inHouse;
  }
  if (selection.filter === "due_out") return dueOut;
  if (selection.filter === "departed") return departed;
  return Prisma.sql`(${dueOut} OR ${departed})`;
}

/** In-house and departure lists: stays joined to their reservation room. */
export function findStayRows(
  tx: Tx,
  propertyId: string,
  businessDate: string,
  selection: StayListFilter,
  options: {
    search: { tokens: string[]; raw: string } | null;
    cursor: { v: string; i: string } | null;
    limit: number;
  },
) {
  return tx.$queryRaw<StaySqlRow[]>`
    SELECT s."id" AS "stay_id", s."status"::text AS "stay_status", s."version" AS "stay_version",
           s."checked_in_at", s."checked_out_at", s."departure_business_date",
           rr."id" AS "reservation_room_id", rr."reservation_id", rr."line_number",
           (SELECT count(*) FROM "reservation_rooms" x WHERE x."reservation_id" = rr."reservation_id")::int AS "room_count",
           res."confirmation_number", rr."arrival_date", rr."departure_date", rr."adults", rr."children",
           rt."id" AS "room_type_id", rt."code" AS "room_type_code", rt."name" AS "room_type_name",
           g."id" AS "guest_id", g."title", g."first_name", g."last_name", g."search_name",
           v."code" AS "vip_code",
           r."id" AS "room_id", r."number" AS "room_number",
           r."housekeeping_status"::text AS "housekeeping_status",
           r."front_office_status"::text AS "front_office_status",
           note."body" AS "latest_note"
    FROM "stays" s
    JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
    JOIN "reservations" res ON res."id" = rr."reservation_id"
    JOIN "room_types" rt ON rt."id" = rr."room_type_id"
    JOIN "guests" g ON g."id" = s."primary_guest_id"
    LEFT JOIN "vip_levels" v ON v."id" = g."vip_level_id"
    JOIN "rooms" r ON r."id" = s."room_id"
    ${latestNote}
    WHERE s."property_id" = ${propertyId}::uuid
      AND ${stayListCondition(selection, businessDate)}
      ${searchCondition(options.search)}
      ${cursorCondition(options.cursor, Prisma.sql`s."id"`)}
    ORDER BY g."search_name", s."id"
    LIMIT ${options.limit + 1}`;
}

export interface SummarySqlRow {
  arrivals_pending: number;
  arrivals_unassigned: number;
  arrivals_checked_in: number;
  in_house: number;
  in_house_arrived_today: number;
  due_out: number;
  departed: number;
}

export async function findSummaryCounts(tx: Tx, propertyId: string, businessDate: string) {
  const rows = await tx.$queryRaw<SummarySqlRow[]>`
    SELECT
      count(*) FILTER (WHERE rr."arrival_date" = ${businessDate}::date AND rr."status" = 'RESERVED')::int AS "arrivals_pending",
      count(*) FILTER (WHERE rr."arrival_date" = ${businessDate}::date AND rr."status" = 'RESERVED' AND rr."room_id" IS NULL)::int AS "arrivals_unassigned",
      count(*) FILTER (WHERE rr."arrival_date" = ${businessDate}::date AND rr."status" = 'IN_HOUSE')::int AS "arrivals_checked_in",
      count(*) FILTER (WHERE rr."status" = 'IN_HOUSE')::int AS "in_house",
      count(*) FILTER (WHERE rr."status" = 'IN_HOUSE' AND rr."arrival_date" = ${businessDate}::date)::int AS "in_house_arrived_today",
      count(*) FILTER (WHERE rr."status" = 'IN_HOUSE' AND rr."departure_date" <= ${businessDate}::date)::int AS "due_out",
      (SELECT count(*) FROM "stays" s
        WHERE s."property_id" = ${propertyId}::uuid AND s."status" = 'CHECKED_OUT'
          AND s."departure_business_date" = ${businessDate}::date)::int AS "departed"
    FROM "reservation_rooms" rr
    WHERE rr."property_id" = ${propertyId}::uuid
      AND ((rr."arrival_date" = ${businessDate}::date AND rr."status" IN ('RESERVED', 'IN_HOUSE'))
           OR rr."status" = 'IN_HOUSE')`;
  return rows[0]!;
}
