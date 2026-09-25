import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Groups and blocks data access. Every query is scoped by the property the
 * group is managed from (`groups.property_id`) or the block's property.
 * Pickup is always counted from the source rows (deducting reservation
 * nights of the block's reservation rooms), never trusted from the cached
 * `block_allocations.picked_up`.
 */

// --- Groups -------------------------------------------------------------------------

export interface GroupListSqlRow {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "CLOSED" | "CANCELLED";
  account: string | null;
  contact_first: string | null;
  contact_last: string | null;
  blocks: number;
  first_night: Date | null;
  departure: Date | null;
  allocated: number;
  released: number;
}

export function findGroupsPage(
  tx: Tx,
  propertyId: string,
  options: { status?: string; q?: string; cursor: { v: string; i: string } | null; limit: number },
) {
  const status = options.status
    ? Prisma.sql`AND g."status" = ${options.status}::"group_status"`
    : Prisma.empty;
  const q = options.q
    ? Prisma.sql`AND (g."code" ILIKE ${`${options.q}%`} OR g."name" ILIKE ${`%${options.q}%`})`
    : Prisma.empty;
  const cursor = options.cursor
    ? Prisma.sql`AND (g."code", g."id") > (${options.cursor.v}, ${options.cursor.i}::uuid)`
    : Prisma.empty;
  return tx.$queryRaw<GroupListSqlRow[]>`
    SELECT g."id", g."code", g."name", g."status"::text AS "status",
           a."name" AS "account", cg."first_name" AS "contact_first", cg."last_name" AS "contact_last",
           count(DISTINCT b."id")::int AS "blocks",
           min(b."start_date") AS "first_night", max(b."end_date") AS "departure",
           COALESCE(sum(al."allocated"), 0)::int AS "allocated",
           COALESCE(sum(al."released"), 0)::int AS "released"
    FROM "groups" g
    LEFT JOIN "account_profiles" a ON a."id" = g."account_profile_id"
    LEFT JOIN "guests" cg ON cg."id" = g."contact_guest_id"
    LEFT JOIN "blocks" b ON b."group_id" = g."id" AND b."property_id" = ${propertyId}::uuid
    LEFT JOIN "block_allocations" al ON al."block_id" = b."id"
    WHERE g."property_id" = ${propertyId}::uuid ${status} ${q} ${cursor}
    GROUP BY g."id", a."name", cg."first_name", cg."last_name"
    ORDER BY g."code", g."id"
    LIMIT ${options.limit + 1}`;
}

/** Room-nights picked up per group (source rows), for the list. */
export function countGroupPickup(tx: Tx, groupIds: string[]) {
  if (groupIds.length === 0) return Promise.resolve([]);
  return tx.$queryRaw<{ group_id: string; picked: number }[]>`
    SELECT b."group_id", count(*)::int AS "picked"
    FROM "reservation_room_nights" n
    JOIN "reservation_rooms" rr ON rr."id" = n."reservation_room_id"
    JOIN "reservation_types" t ON t."id" = rr."reservation_type_id"
    JOIN "blocks" b ON b."id" = rr."block_id"
    JOIN "block_allocations" a ON a."block_id" = b."id"
      AND a."room_type_id" = n."room_type_id" AND a."stay_date" = n."stay_date"
    WHERE b."group_id" = ANY(${groupIds}::uuid[])
      AND rr."status" IN ('RESERVED', 'IN_HOUSE', 'CHECKED_OUT') AND t."deducts_inventory"
    GROUP BY 1`;
}

const groupSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  notes: true,
  createdAt: true,
  account: { select: { id: true, name: true } },
  contactGuest: { select: { id: true, firstName: true, lastName: true } },
} as const satisfies Prisma.GroupSelect;

export function findGroup(tx: Tx, propertyId: string, id: string) {
  return tx.group.findFirst({ where: { id, propertyId }, select: groupSelect });
}

export async function lockGroup(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string; status: string; code: string }[]>`
    SELECT "id", "status"::text AS "status", "code" FROM "groups"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

export function insertGroup(tx: Tx, data: Prisma.GroupUncheckedCreateInput) {
  return tx.group.create({ data, select: { id: true } });
}

export function updateGroupRow(tx: Tx, id: string, data: Prisma.GroupUncheckedUpdateInput) {
  return tx.group.update({ where: { id }, data, select: { id: true } });
}

// --- Blocks -------------------------------------------------------------------------

const blockSelect = {
  id: true,
  groupId: true,
  code: true,
  name: true,
  version: true,
  startDate: true,
  endDate: true,
  cutoffDate: true,
  isElastic: true,
  ratePlanId: true,
  reservationTypeId: true,
  marketCodeId: true,
  sourceCodeId: true,
  cancellationPolicyId: true,
  depositPolicyId: true,
  status: {
    select: { id: true, code: true, name: true, type: true, allowsPickup: true },
  },
  ratePlan: { select: { id: true, code: true, name: true } },
  reservationType: { select: { id: true, code: true, name: true } },
} as const satisfies Prisma.BlockSelect;

export type BlockRow = Prisma.BlockGetPayload<{ select: typeof blockSelect }>;

export function findBlocksOfGroup(tx: Tx, propertyId: string, groupId: string) {
  return tx.block.findMany({
    where: { propertyId, groupId },
    orderBy: [{ startDate: "asc" }, { code: "asc" }],
    select: blockSelect,
  });
}

export function findBlock(tx: Tx, propertyId: string, id: string) {
  return tx.block.findFirst({ where: { id, propertyId }, select: blockSelect });
}

/** Locks a block FOR UPDATE (block commands; ARCHITECTURE §5 — before inventory cells). */
export async function lockBlock(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string; version: number }[]>`
    SELECT "id", "version" FROM "blocks"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  if (rows.length === 0) return null;
  return findBlock(tx, propertyId, id);
}

/** Locks a block FOR SHARE (pickups: serializes with status changes and releases). */
export async function lockBlockShare(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "blocks"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR SHARE`;
  if (rows.length === 0) return null;
  return findBlock(tx, propertyId, id);
}

export function insertBlock(tx: Tx, data: Prisma.BlockUncheckedCreateInput) {
  return tx.block.create({ data, select: { id: true } });
}

export function updateBlockVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.BlockUncheckedUpdateManyInput,
) {
  return tx.block.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

export function findBlockStatus(tx: Tx, propertyId: string, id: string) {
  return tx.blockStatus.findFirst({
    where: { id, propertyId, status: "ACTIVE" },
    select: { id: true, code: true, name: true, type: true, allowsPickup: true },
  });
}

export function findCancelStatus(tx: Tx, propertyId: string) {
  return tx.blockStatus.findFirst({
    where: { propertyId, status: "ACTIVE", type: "CANCEL" },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    select: { id: true, code: true },
  });
}

export interface GridRow {
  block_id: string;
  room_type_id: string;
  room_type_code: string;
  room_type_name: string;
  stay_date: Date;
  allocated: number;
  released: number;
  picked: number;
}

/** Allocation grid of blocks with pickup counted from the source rows. */
export function findBlockGrid(tx: Tx, blockIds: string[]) {
  if (blockIds.length === 0) return Promise.resolve([] as GridRow[]);
  return tx.$queryRaw<GridRow[]>`
    SELECT a."block_id", a."room_type_id", rt."code" AS "room_type_code", rt."name" AS "room_type_name",
           a."stay_date", a."allocated", a."released",
           (SELECT count(*)::int
              FROM "reservation_room_nights" n
              JOIN "reservation_rooms" rr ON rr."id" = n."reservation_room_id"
              JOIN "reservation_types" t ON t."id" = rr."reservation_type_id"
             WHERE rr."block_id" = a."block_id"
               AND n."room_type_id" = a."room_type_id" AND n."stay_date" = a."stay_date"
               AND rr."status" IN ('RESERVED', 'IN_HOUSE', 'CHECKED_OUT') AND t."deducts_inventory") AS "picked"
    FROM "block_allocations" a
    JOIN "room_types" rt ON rt."id" = a."room_type_id"
    WHERE a."block_id" = ANY(${blockIds}::uuid[])
    ORDER BY rt."sort_order", rt."code", a."stay_date"`;
}

export function upsertAllocation(
  tx: Tx,
  row: {
    propertyId: string;
    blockId: string;
    roomTypeId: string;
    stayDate: Date;
    allocated: number;
  },
) {
  return tx.blockAllocation.upsert({
    where: {
      blockId_roomTypeId_stayDate: {
        blockId: row.blockId,
        roomTypeId: row.roomTypeId,
        stayDate: row.stayDate,
      },
    },
    update: { allocated: row.allocated },
    create: row,
  });
}

export function setReleased(
  tx: Tx,
  row: { blockId: string; roomTypeId: string; stayDate: Date; released: number },
) {
  return tx.blockAllocation.update({
    where: {
      blockId_roomTypeId_stayDate: {
        blockId: row.blockId,
        roomTypeId: row.roomTypeId,
        stayDate: row.stayDate,
      },
    },
    data: { released: row.released },
  });
}

/** Active pickups (reserved or in house) of a block. */
export function countActivePickup(tx: Tx, blockId: string) {
  return tx.reservationRoom.count({
    where: { blockId, status: { in: ["RESERVED", "IN_HOUSE"] } },
  });
}

export function findGroupReservations(tx: Tx, propertyId: string, groupId: string) {
  return tx.reservationRoom.findMany({
    where: { propertyId, reservation: { groupId } },
    orderBy: [{ arrivalDate: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      reservationId: true,
      lineNumber: true,
      status: true,
      arrivalDate: true,
      departureDate: true,
      reservation: { select: { confirmationNumber: true } },
      primaryGuest: { select: { firstName: true, lastName: true } },
      roomType: { select: { code: true } },
      block: { select: { code: true } },
    },
  });
}

export async function findGroupOptions(tx: Tx, propertyId: string) {
  const active = { propertyId, status: "ACTIVE" as const };
  const ref = { id: true, code: true, name: true } as const;
  return {
    statuses: await tx.blockStatus.findMany({
      where: active,
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { ...ref, type: true, allowsPickup: true, isDefault: true },
    }),
    ratePlans: await tx.ratePlan.findMany({
      where: active,
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: ref,
    }),
    roomTypes: await tx.roomType.findMany({
      where: { ...active, isPseudo: false, isSellable: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: ref,
    }),
    reservationTypes: await tx.reservationType.findMany({
      where: active,
      orderBy: { code: "asc" },
      select: { ...ref, deductsInventory: true },
    }),
    marketCodes: await tx.marketCode.findMany({
      where: active,
      orderBy: { code: "asc" },
      select: ref,
    }),
    sourceCodes: await tx.sourceCode.findMany({
      where: active,
      orderBy: { code: "asc" },
      select: ref,
    }),
  };
}

export function findPlanRoomTypes(tx: Tx, ratePlanId: string) {
  return tx.ratePlanRoomType.findMany({ where: { ratePlanId }, select: { roomTypeId: true } });
}
