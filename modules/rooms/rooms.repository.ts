import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Room status data access (rooms, room_status_history). Every query is
 * scoped by property.
 */

export interface LockedRoomRow {
  id: string;
  number: string;
  room_type_id: string;
  status: string;
  housekeeping_status: string;
  front_office_status: string;
  version: number;
  out_of_order: boolean;
}

/**
 * Row-locks rooms in id order (deterministic, so two commands touching the
 * same rooms queue instead of deadlocking) and reports whether an
 * out-of-order block covers the business date.
 */
export function lockRooms(tx: Tx, propertyId: string, ids: string[], businessDate: string) {
  const sorted = [...new Set(ids)].sort();
  return tx.$queryRaw<LockedRoomRow[]>`
    SELECT r."id", r."number", r."room_type_id", r."status"::text AS "status",
           r."housekeeping_status"::text AS "housekeeping_status",
           r."front_office_status"::text AS "front_office_status", r."version",
           EXISTS (
             SELECT 1 FROM "room_service_blocks" b
             WHERE b."room_id" = r."id" AND b."kind" = 'OUT_OF_ORDER'
               AND b."status" IN ('SCHEDULED', 'ACTIVE')
               AND b."from_date" <= ${businessDate}::date AND b."to_date" > ${businessDate}::date
           ) AS "out_of_order"
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
      changedById: true,
      createdAt: true,
      room: { select: { number: true } },
    },
  });
}
