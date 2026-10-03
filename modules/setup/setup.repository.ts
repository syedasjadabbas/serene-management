import "server-only";
import type { Tx } from "@/lib/db/prisma";
import { fromDateOnly } from "@/modules/business-date/business-date.policy";

/** Data access for property setup (modules/setup). Every query is scoped by property. */

export function findSetupRoomTypes(tx: Tx, propertyId: string) {
  return tx.roomType.findMany({
    where: { propertyId, isPseudo: false },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      maxOccupancy: true,
      maxAdults: true,
      maxChildren: true,
      defaultOccupancy: true,
      sortOrder: true,
      status: true,
      _count: { select: { rooms: { where: { status: "ACTIVE" } } } },
    },
  });
}

export function findSetupFloors(tx: Tx, propertyId: string) {
  return tx.floor.findMany({
    where: { propertyId },
    orderBy: [{ sortOrder: "asc" }, { level: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      level: true,
      sortOrder: true,
      status: true,
      _count: { select: { rooms: { where: { status: "ACTIVE" } } } },
    },
  });
}

export function findSetupRooms(tx: Tx, propertyId: string) {
  return tx.room.findMany({
    where: { propertyId, roomType: { isPseudo: false } },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      roomTypeId: true,
      floorId: true,
      description: true,
      isSmoking: true,
      isAccessible: true,
      status: true,
      housekeepingStatus: true,
      frontOfficeStatus: true,
      version: true,
      roomType: { select: { code: true } },
      floor: { select: { name: true } },
    },
  });
}

export function findSetupTaxes(tx: Tx, propertyId: string) {
  return tx.taxRule.findMany({
    where: { propertyId },
    orderBy: [{ code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      calculation: true,
      basis: true,
      rate: true,
      effectiveFrom: true,
      effectiveTo: true,
      status: true,
      transactionCodeId: true,
      appliesTo: {
        orderBy: { sequence: "asc" },
        select: { transactionCode: { select: { id: true, code: true, name: true } } },
      },
    },
  });
}

/** Active revenue codes a tax can be added to (never tax or payment codes). */
export function findTaxableCodes(tx: Tx, propertyId: string) {
  return tx.transactionCode.findMany({
    where: {
      propertyId,
      status: "ACTIVE",
      bucket: { notIn: ["TAX", "SERVICE_CHARGE", "PAYMENT", "NON_REVENUE"] },
      group: { type: "REVENUE" },
    },
    orderBy: [{ code: "asc" }],
    select: { id: true, code: true, name: true, group: { select: { name: true } } },
  });
}

export async function countSetup(tx: Tx, propertyId: string) {
  const [roomTypes, rooms, taxes, ratePlans] = await Promise.all([
    tx.roomType.count({ where: { propertyId, status: "ACTIVE", isPseudo: false } }),
    tx.room.count({ where: { propertyId, status: "ACTIVE", roomType: { isPseudo: false } } }),
    tx.taxRule.count({ where: { propertyId, status: "ACTIVE" } }),
    tx.ratePlan.count({ where: { propertyId, status: "ACTIVE" } }),
  ]);
  return { roomTypes, rooms, taxes, ratePlans };
}

/** Locks one room row for an edit (optimistic version checked by the caller). */
export async function lockSetupRoom(tx: Tx, propertyId: string, roomId: string) {
  const rows = await tx.$queryRaw<{ id: string; version: number }[]>`
    SELECT "id", "version" FROM "rooms"
    WHERE "property_id" = ${propertyId}::uuid AND "id" = ${roomId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Why a room cannot change type or leave service now: a guest is in it, or a
 * live reservation (arriving or in house, not yet departed) is assigned to it.
 */
export async function roomCommitments(tx: Tx, propertyId: string, roomId: string, from: string) {
  const [inHouse, assigned] = await Promise.all([
    tx.stay.count({ where: { propertyId, roomId, status: "IN_HOUSE" } }),
    tx.reservationRoom.count({
      where: {
        propertyId,
        roomId,
        status: { in: ["RESERVED", "IN_HOUSE"] },
        departureDate: { gt: fromDateOnly(from) },
      },
    }),
  ]);
  return { inHouse, assigned };
}

/** Live bookings of a room type from `from` on (it cannot be retired while they exist). */
export function roomTypeBookings(tx: Tx, propertyId: string, roomTypeId: string, from: string) {
  return tx.reservationRoom.count({
    where: {
      propertyId,
      roomTypeId,
      status: { in: ["WAITLISTED", "RESERVED", "IN_HOUSE"] },
      departureDate: { gt: fromDateOnly(from) },
    },
  });
}

/** Room numbers of the list that already exist at the property. */
export async function existingRoomNumbers(tx: Tx, propertyId: string, numbers: string[]) {
  const rows = await tx.room.findMany({
    where: { propertyId, number: { in: numbers } },
    select: { number: true },
  });
  return rows.map((r) => r.number);
}

/** The next free tax posting code (8000, 8010, …) for a new tax rule. */
export async function nextTaxPostingCode(tx: Tx, propertyId: string): Promise<string> {
  const rows = await tx.transactionCode.findMany({
    where: { propertyId, code: { startsWith: "8" } },
    select: { code: true },
  });
  const used = new Set(rows.map((r) => r.code));
  for (let n = 8000; n <= 8990; n += 10) if (!used.has(String(n))) return String(n);
  for (let n = 8001; n <= 8999; n++) if (!used.has(String(n))) return String(n);
  throw new Error("No free tax posting code between 8000 and 8999");
}
