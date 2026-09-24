import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";
import type { TaskStatus } from "./housekeeping.policy";

/**
 * Housekeeping data access (housekeeping_tasks, task types, attendants).
 * Every query is scoped by property.
 */

export function findTaskTypes(tx: Tx, propertyId: string) {
  return tx.housekeepingTaskType.findMany({
    where: { propertyId, status: "ACTIVE" },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      requiresInspection: true,
      changesRoomStatus: true,
      estimatedMinutes: true,
      credits: true,
    },
  });
}

export function findTaskType(tx: Tx, propertyId: string, where: { id?: string; code?: string }) {
  return tx.housekeepingTaskType.findFirst({
    where: { propertyId, status: "ACTIVE", ...where },
    select: { id: true, code: true, name: true, requiresInspection: true, credits: true },
  });
}

// --- Attendants (roster entries of system users) ------------------------------------------

export function findAttendantByUser(tx: Tx, propertyId: string, userId: string) {
  return tx.housekeepingAttendant.findFirst({
    where: { propertyId, userId },
    select: { id: true, name: true, status: true },
  });
}

/** Creates the roster entry of a user; a concurrent creation for the same user is ignored. */
export async function insertAttendantForUser(
  tx: Tx,
  propertyId: string,
  user: { id: string; displayName: string },
) {
  await tx.$executeRaw`
    INSERT INTO "housekeeping_attendants" ("id", "property_id", "user_id", "code", "name", "status")
    VALUES (gen_random_uuid(), ${propertyId}::uuid, ${user.id}::uuid,
            ${`U${user.id.replace(/-/g, "").slice(-10).toUpperCase()}`}, ${user.displayName.slice(0, 120)}, 'ACTIVE')
    ON CONFLICT DO NOTHING`;
  return findAttendantByUser(tx, propertyId, user.id);
}

// --- Tasks ------------------------------------------------------------------------------------

export function insertTask(tx: Tx, data: Prisma.HousekeepingTaskUncheckedCreateInput) {
  return tx.housekeepingTask.create({ data, select: { id: true } });
}

export function findTaskRef(tx: Tx, propertyId: string, id: string) {
  return tx.housekeepingTask.findFirst({
    where: { id, propertyId },
    select: { id: true, roomId: true },
  });
}

export interface LockedTaskRow {
  id: string;
  room_id: string;
  task_type_id: string;
  business_date: Date;
  status: TaskStatus;
  priority: number;
  version: number;
  attendant_id: string | null;
  attendant_user_id: string | null;
  attendant_name: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  completed_by_id: string | null;
  notes: string | null;
  type_code: string;
  type_requires_inspection: boolean;
  type_changes_room_status: boolean;
}

/** Locks a task FOR UPDATE (after its room, per the lock order). */
export async function lockTask(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<LockedTaskRow[]>`
    SELECT t."id", t."room_id", t."task_type_id", t."business_date", t."status"::text AS "status",
           t."priority", t."version", t."attendant_id", a."user_id" AS "attendant_user_id",
           a."name" AS "attendant_name", t."started_at", t."completed_at", t."completed_by_id",
           t."notes", tt."code" AS "type_code", tt."requires_inspection" AS "type_requires_inspection",
           tt."changes_room_status" AS "type_changes_room_status"
    FROM "housekeeping_tasks" t
    JOIN "housekeeping_task_types" tt ON tt."id" = t."task_type_id"
    LEFT JOIN "housekeeping_attendants" a ON a."id" = t."attendant_id"
    WHERE t."id" = ${id}::uuid AND t."property_id" = ${propertyId}::uuid
    FOR UPDATE OF t`;
  return rows[0] ?? null;
}

export function updateTaskVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.HousekeepingTaskUncheckedUpdateManyInput,
) {
  return tx.housekeepingTask.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

/** The live (not cancelled) task of a type for a room on a business date. */
export function findLiveTask(
  tx: Tx,
  propertyId: string,
  roomId: string,
  businessDate: Date,
  taskTypeId: string,
) {
  return tx.housekeepingTask.findFirst({
    where: { propertyId, roomId, businessDate, taskTypeId, status: { not: "CANCELLED" } },
    select: { id: true, status: true, priority: true, version: true, notes: true },
  });
}

/** The most recent cleaning of the room that waits for (or can take) an inspection. */
export async function lockTaskAwaitingInspection(tx: Tx, propertyId: string, roomId: string) {
  const rows = await tx.$queryRaw<
    { id: string; version: number; completed_by_id: string | null }[]
  >`
    SELECT t."id", t."version", t."completed_by_id"
    FROM "housekeeping_tasks" t
    WHERE t."property_id" = ${propertyId}::uuid AND t."room_id" = ${roomId}::uuid
      AND t."status" = 'COMPLETED'
    ORDER BY t."completed_at" DESC
    LIMIT 1
    FOR UPDATE OF t`;
  return rows[0] ?? null;
}

const taskSelect = {
  id: true,
  version: true,
  businessDate: true,
  status: true,
  priority: true,
  notes: true,
  startedAt: true,
  completedAt: true,
  completedById: true,
  inspectedAt: true,
  inspectedById: true,
  createdAt: true,
  room: {
    select: {
      id: true,
      number: true,
      version: true,
      housekeepingStatus: true,
      frontOfficeStatus: true,
      floor: { select: { name: true } },
      roomType: { select: { code: true } },
    },
  },
  taskType: {
    select: { id: true, code: true, name: true, requiresInspection: true },
  },
  attendant: { select: { id: true, name: true, userId: true } },
} as const satisfies Prisma.HousekeepingTaskSelect;

export type TaskRow = Prisma.HousekeepingTaskGetPayload<{ select: typeof taskSelect }>;

export function findTasksPage(
  tx: Tx,
  where: Prisma.HousekeepingTaskWhereInput,
  cursor: string | null,
  take: number,
) {
  return tx.housekeepingTask.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: taskSelect,
  });
}

export function findTask(tx: Tx, propertyId: string, id: string) {
  return tx.housekeepingTask.findFirst({ where: { id, propertyId }, select: taskSelect });
}

/** Rooms (of the given ids) with a reservation arriving on the business date. */
export async function findRoomsWithArrival(
  tx: Tx,
  propertyId: string,
  roomIds: string[],
  businessDate: Date,
) {
  if (roomIds.length === 0) return new Set<string>();
  const rows = await tx.reservationRoom.findMany({
    where: {
      propertyId,
      roomId: { in: roomIds },
      status: "RESERVED",
      arrivalDate: businessDate,
    },
    select: { roomId: true },
  });
  return new Set(rows.map((r) => r.roomId!));
}

/** Out-of-order / out-of-service blocks covering the business date, for the given rooms. */
export async function findBlockedRooms(
  tx: Tx,
  roomIds: string[],
  businessDate: Date,
): Promise<Map<string, "OUT_OF_ORDER" | "OUT_OF_SERVICE">> {
  if (roomIds.length === 0) return new Map();
  const rows = await tx.roomServiceBlock.findMany({
    where: {
      roomId: { in: roomIds },
      status: { in: ["SCHEDULED", "ACTIVE"] },
      fromDate: { lte: businessDate },
      toDate: { gt: businessDate },
    },
    select: { roomId: true, kind: true },
  });
  return new Map(rows.map((r) => [r.roomId, r.kind]));
}

export async function countTasks(
  tx: Tx,
  propertyId: string,
  businessDate: Date,
  attendantId: string | null,
) {
  const open = { in: ["PENDING", "IN_PROGRESS", "PAUSED", "FAILED_INSPECTION"] as TaskStatus[] };
  const carried = {
    propertyId,
    OR: [{ businessDate }, { businessDate: { lt: businessDate }, status: open }],
  } satisfies Prisma.HousekeepingTaskWhereInput;
  const grouped = await tx.housekeepingTask.groupBy({
    by: ["status"],
    where: carried,
    _count: { _all: true },
  });
  const unassigned = await tx.housekeepingTask.count({
    where: { ...carried, status: open, attendantId: null },
  });
  const mine = attendantId
    ? await tx.housekeepingTask.count({ where: { ...carried, status: open, attendantId } })
    : 0;
  return { grouped, unassigned, mine };
}
