import "server-only";
import type { Tx } from "@/lib/db/prisma";

/**
 * Availability data access. Every figure is aggregated in PostgreSQL from the
 * source rows (rooms, out-of-order blocks, reservation nights); nothing is
 * loaded into JavaScript to be counted. Ranges are half-open: [from, to).
 */

type Db = Tx;

export function findSellableRoomTypes(db: Db, propertyId: string, roomTypeIds?: string[]) {
  return db.roomType.findMany({
    where: {
      propertyId,
      status: "ACTIVE",
      isSellable: true,
      isPseudo: false,
      ...(roomTypeIds ? { id: { in: roomTypeIds } } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      maxOccupancy: true,
      maxAdults: true,
      maxChildren: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
}

export async function countPhysicalRooms(db: Db, propertyId: string, roomTypeIds: string[]) {
  if (roomTypeIds.length === 0) return new Map<string, number>();
  const rows = await db.room.groupBy({
    by: ["roomTypeId"],
    where: { propertyId, status: "ACTIVE", roomTypeId: { in: roomTypeIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.roomTypeId, row._count._all]));
}

export function countOutOfOrder(
  db: Db,
  propertyId: string,
  roomTypeIds: string[],
  from: string,
  to: string,
) {
  if (roomTypeIds.length === 0) return Promise.resolve([]);
  return db.$queryRaw<{ room_type_id: string; stay_date: Date; rooms: number }[]>`
    SELECT r."room_type_id", d::date AS "stay_date", count(DISTINCT b."room_id")::int AS "rooms"
    FROM generate_series(${from}::date, ${to}::date - 1, interval '1 day') AS d
    JOIN "room_service_blocks" b
      ON b."property_id" = ${propertyId}::uuid
     AND b."kind" = 'OUT_OF_ORDER'
     AND b."status" IN ('SCHEDULED', 'ACTIVE')
     AND b."from_date" <= d::date AND b."to_date" > d::date
    JOIN "rooms" r ON r."id" = b."room_id" AND r."status" = 'ACTIVE'
    WHERE r."room_type_id" = ANY(${roomTypeIds}::uuid[])
    GROUP BY 1, 2`;
}

/**
 * Rooms committed per room type and night by reservations that are reserved
 * or in house. Deducting reservation types count as sold; non-deducting
 * (tentative) ones are reported separately. Cancelled, no-show, waitlisted
 * and checked-out reservations never count.
 */
export function countCommittedNights(
  db: Db,
  propertyId: string,
  roomTypeIds: string[],
  from: string,
  to: string,
  excludeReservationRoomIds: string[] = [],
) {
  if (roomTypeIds.length === 0) return Promise.resolve([]);
  return db.$queryRaw<{ room_type_id: string; stay_date: Date; sold: number; tentative: number }[]>`
    SELECT n."room_type_id", n."stay_date",
           count(*) FILTER (WHERE t."deducts_inventory")::int AS "sold",
           count(*) FILTER (WHERE NOT t."deducts_inventory")::int AS "tentative"
    FROM "reservation_room_nights" n
    JOIN "reservation_rooms" rr ON rr."id" = n."reservation_room_id"
    JOIN "reservation_types" t ON t."id" = rr."reservation_type_id"
    WHERE n."property_id" = ${propertyId}::uuid
      AND n."stay_date" >= ${from}::date AND n."stay_date" < ${to}::date
      AND n."room_type_id" = ANY(${roomTypeIds}::uuid[])
      AND rr."status" IN ('RESERVED', 'IN_HOUSE')
      AND NOT (rr."id" = ANY(${excludeReservationRoomIds}::uuid[]))
    GROUP BY 1, 2`;
}

export function findInventoryControls(
  db: Db,
  propertyId: string,
  roomTypeIds: string[],
  from: string,
  to: string,
) {
  if (roomTypeIds.length === 0) return Promise.resolve([]);
  return db.$queryRaw<
    {
      room_type_id: string;
      stay_date: Date;
      blocked: number;
      overbook_limit: number;
      sell_limit: number | null;
    }[]
  >`
    SELECT "room_type_id", "stay_date", "blocked", "overbook_limit", "sell_limit"
    FROM "room_type_inventory"
    WHERE "property_id" = ${propertyId}::uuid
      AND "room_type_id" = ANY(${roomTypeIds}::uuid[])
      AND "stay_date" >= ${from}::date AND "stay_date" < ${to}::date`;
}

/** Restrictions on any date from arrival through departure (inclusive, for closed-to-departure). */
export function findRestrictions(db: Db, propertyId: string, arrival: string, departure: string) {
  return db.restriction.findMany({
    where: {
      propertyId,
      stayDate: {
        gte: new Date(`${arrival}T00:00:00.000Z`),
        lte: new Date(`${departure}T00:00:00.000Z`),
      },
    },
    select: { stayDate: true, type: true, roomTypeId: true, ratePlanId: true, value: true },
  });
}

/**
 * Serialization point for selling inventory: makes sure a counter row exists
 * for every (room type, night), then locks them FOR UPDATE in a fixed order
 * (room type, date) so concurrent bookings of the same nights queue behind
 * each other instead of both seeing the "last room". Held until commit.
 */
export async function lockInventoryCells(
  tx: Tx,
  propertyId: string,
  cells: readonly { roomTypeId: string; stayDate: string }[],
): Promise<void> {
  if (cells.length === 0) return;
  const sorted = [...cells].sort((a, b) =>
    a.roomTypeId === b.roomTypeId
      ? a.stayDate.localeCompare(b.stayDate)
      : a.roomTypeId.localeCompare(b.roomTypeId),
  );
  const roomTypeIds = sorted.map((c) => c.roomTypeId);
  const dates = sorted.map((c) => c.stayDate);
  await tx.$executeRaw`
    INSERT INTO "room_type_inventory" ("property_id", "room_type_id", "stay_date", "physical_rooms", "updated_at")
    SELECT ${propertyId}::uuid, c."room_type_id", c."stay_date", 0, now()
    FROM unnest(${roomTypeIds}::uuid[], ${dates}::date[]) AS c("room_type_id", "stay_date")
    ORDER BY c."room_type_id", c."stay_date"
    ON CONFLICT ("room_type_id", "stay_date") DO NOTHING`;
  await tx.$queryRaw`
    SELECT 1
    FROM "room_type_inventory" i
    JOIN unnest(${roomTypeIds}::uuid[], ${dates}::date[]) AS c("room_type_id", "stay_date")
      ON i."room_type_id" = c."room_type_id" AND i."stay_date" = c."stay_date"
    WHERE i."property_id" = ${propertyId}::uuid
    ORDER BY i."room_type_id", i."stay_date"
    FOR UPDATE OF i`;
}

/** Writes the recomputed figures back to the (locked) counter rows. */
export async function writeInventoryCounters(
  tx: Tx,
  propertyId: string,
  cells: readonly {
    roomTypeId: string;
    stayDate: string;
    physical: number;
    outOfOrder: number;
    sold: number;
  }[],
): Promise<void> {
  if (cells.length === 0) return;
  await tx.$executeRaw`
    UPDATE "room_type_inventory" i
    SET "physical_rooms" = c."physical", "out_of_order" = c."ooo", "sold" = c."sold", "updated_at" = now()
    FROM unnest(
      ${cells.map((c) => c.roomTypeId)}::uuid[],
      ${cells.map((c) => c.stayDate)}::date[],
      ${cells.map((c) => c.physical)}::int[],
      ${cells.map((c) => c.outOfOrder)}::int[],
      ${cells.map((c) => c.sold)}::int[]
    ) AS c("room_type_id", "stay_date", "physical", "ooo", "sold")
    WHERE i."property_id" = ${propertyId}::uuid
      AND i."room_type_id" = c."room_type_id" AND i."stay_date" = c."stay_date"`;
}
