import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { AppError, forbidden, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasPermission } from "@/lib/permissions/evaluate";
import { userHasPermission, usersWithPermission } from "@/modules/access/access.service";
import { recordAudit, userDisplayNames } from "@/modules/audit/audit.service";
import { fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { frontOfficeRules } from "@/modules/properties/properties.service";
import {
  type HousekeepingAction,
  type HousekeepingStatus,
  housekeepingTransition,
  roomReadiness,
} from "@/modules/rooms/rooms.policy";
import { changeRoomStatus, lockRoomsForUpdate } from "@/modules/rooms/rooms.service";
import type { CursorPageMeta } from "@/types/api";
import {
  OPEN_TASK_STATUSES,
  PRIORITY_VALUES,
  type TaskAction,
  cleaningPriority,
  type TaskPriority,
  type TaskStatus,
  needsInspection,
  priorityLabel,
  taskActorProblem,
  taskTransition,
} from "./housekeeping.policy";
import {
  type LockedTaskRow,
  type TaskRow,
  countTasks,
  findAttendantByUser,
  findBlockedRooms,
  findLiveTask,
  findRoomsWithArrival,
  findTask,
  findTaskRef,
  findTaskType,
  findTaskTypes,
  findTasksPage,
  insertAttendantForUser,
  insertTask,
  lockTask,
  lockTaskAwaitingInspection,
  updateTaskVersioned,
} from "./housekeeping.repository";
import type {
  AssignTaskInput,
  CloseTaskInput,
  CreateTaskInput,
  InspectRoomInput,
  RoomHousekeepingInput,
  TaskCommandInput,
  TasksQuery,
} from "./housekeeping.schema";
import type {
  AssigneeView,
  HousekeepingSummary,
  TaskTypeView,
  TaskView,
} from "./housekeeping.types";

/**
 * Housekeeping (docs/PMS_WORKFLOWS.md §13): cleaning tasks, assignment to
 * users, room inspection and room-level housekeeping corrections.
 *
 * Commands run in one transaction in the documented lock order: business
 * date (FOR SHARE) → room (FOR UPDATE) → task (FOR UPDATE, with the client's
 * version). The server decides every status: clients send actions, never
 * target statuses. Room changes are written to room_status_history and
 * every command is audited.
 */

// --- Helpers ------------------------------------------------------------------------

function requirePermission(ctx: PropertyContext, permission: Permission) {
  if (!hasPermission(ctx.access, ctx.propertyId, permission)) throw forbidden(permission);
}

const can = (ctx: PropertyContext, permission: Permission) =>
  hasPermission(ctx.access, ctx.propertyId, permission);

function requireBusinessDate(ctx: PropertyContext): string {
  if (!ctx.businessDate) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The property business date has not been initialized",
    );
  }
  return ctx.businessDate;
}

function assertTaskTransition(action: TaskAction, status: TaskStatus): TaskStatus {
  const result = taskTransition(action, status);
  if ("problem" in result) {
    throw new AppError("INVALID_STATE_TRANSITION", result.problem, { action, status });
  }
  return result.next;
}

function assertRoomTransition(action: HousekeepingAction, current: HousekeepingStatus) {
  const result = housekeepingTransition(action, current);
  if ("problem" in result) {
    throw new AppError("INVALID_STATE_TRANSITION", result.problem, {
      action,
      housekeepingStatus: current,
    });
  }
  return result.next;
}

/**
 * The property roster entry of a user who may do housekeeping work
 * (`housekeeping:update`). Attendants are system users; the roster row is
 * created on first assignment.
 */
async function requireAttendant(tx: Tx, ctx: PropertyContext, userId: string) {
  const user = await userHasPermission(
    tx,
    ctx.organizationId,
    ctx.propertyId,
    userId,
    "housekeeping:update",
  );
  if (!user) {
    throw new AppError(
      "VALIDATION_FAILED",
      "The assignee cannot do housekeeping work at this property",
      { fields: { assigneeId: ["Choose a housekeeping user of this property"] } },
    );
  }
  const attendant =
    (await findAttendantByUser(tx, ctx.propertyId, userId)) ??
    (await insertAttendantForUser(tx, ctx.propertyId, user));
  if (!attendant || attendant.status !== "ACTIVE") {
    throw new AppError("BUSINESS_RULE_VIOLATION", "This attendant is inactive", {
      reason: "ATTENDANT_INACTIVE",
    });
  }
  return { id: attendant.id, name: attendant.name, userId };
}

async function lockTaskOrThrow(tx: Tx, ctx: PropertyContext, taskId: string, version: number) {
  const task = await lockTask(tx, ctx.propertyId, taskId);
  if (!task) throw notFound("Housekeeping task");
  if (task.version !== version) throw staleVersion("Housekeeping task");
  return task;
}

async function saveTask(
  tx: Tx,
  task: LockedTaskRow,
  data: Prisma.HousekeepingTaskUncheckedUpdateManyInput,
) {
  const { count } = await updateTaskVersioned(tx, task.id, task.version, data);
  if (count !== 1) throw staleVersion("Housekeeping task");
}

function audit(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  entry: Parameters<typeof recordAudit>[2],
) {
  return recordAudit(tx, { ...auditActor(ctx), businessDate }, entry);
}

// --- Cleaning queue (called by other modules inside their transaction) --------------------

/** System code of the full-clean task type queued after departures, moves and maintenance. */
export const DEPARTURE_CLEAN_TYPE = "DEP";

/**
 * Queues the full clean of a vacated room inside the caller's transaction
 * (which already holds the room lock): after a check-out, a room move or a
 * return to service. One live task per room, type and business date: a task
 * that is already open is kept (its priority raised when needed); a finished
 * one is reopened. Returns null when the property has no departure-clean
 * task type configured (the room is still dirty and visible on the board).
 */
export async function queueCleaningInTx(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  input: {
    roomId: string;
    stayId?: string | null;
    /** Defaults to URGENT when a guest arrives in the room today, NORMAL otherwise. */
    priority?: TaskPriority;
    afterMaintenance?: boolean;
    note: string;
  },
): Promise<{ taskId: string; reopened: boolean; priority: TaskPriority } | null> {
  const type = await findTaskType(tx, ctx.propertyId, { code: DEPARTURE_CLEAN_TYPE });
  if (!type) return null;
  const date = fromDateOnly(businessDate);
  const arrivingToday = (await findRoomsWithArrival(tx, ctx.propertyId, [input.roomId], date)).has(
    input.roomId,
  );
  const derived = cleaningPriority({
    arrivingToday,
    afterMaintenance: input.afterMaintenance ?? false,
  });
  const label =
    input.priority && PRIORITY_VALUES[input.priority] < PRIORITY_VALUES[derived]
      ? input.priority
      : derived;
  const priority = PRIORITY_VALUES[label];
  const existing = await findLiveTask(tx, ctx.propertyId, input.roomId, date, type.id);
  if (!existing) {
    const task = await insertTask(tx, {
      propertyId: ctx.propertyId,
      roomId: input.roomId,
      taskTypeId: type.id,
      businessDate: date,
      priority,
      credits: type.credits,
      stayId: input.stayId ?? null,
      notes: input.note,
    });
    return { taskId: task.id, reopened: false, priority: label };
  }
  const open = OPEN_TASK_STATUSES.includes(existing.status as TaskStatus);
  const { count } = await updateTaskVersioned(tx, existing.id, existing.version, {
    priority: Math.min(existing.priority, priority),
    ...(open
      ? {}
      : {
          status: "PENDING",
          startedAt: null,
          completedAt: null,
          completedById: null,
          inspectedAt: null,
          inspectedById: null,
          stayId: input.stayId ?? null,
          notes: [existing.notes, input.note].filter(Boolean).join(" · ").slice(0, 2000),
        }),
  });
  if (count !== 1) throw staleVersion("Housekeeping task");
  return { taskId: existing.id, reopened: !open, priority: label };
}

// --- Task commands ------------------------------------------------------------------------

export async function createTask(ctx: PropertyContext, input: CreateTaskInput): Promise<TaskView> {
  requirePermission(ctx, "housekeeping:assign");
  const taskId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [input.roomId]);
    const room = rooms.get(input.roomId)!;
    if (!room.active) throw notFound("Room");
    const type = await findTaskType(tx, ctx.propertyId, { id: input.taskTypeId });
    if (!type) throw notFound("Task type");
    const date = fromDateOnly(businessDate);
    if (await findLiveTask(tx, ctx.propertyId, room.id, date, type.id)) {
      throw new AppError(
        "CONFLICT",
        `Room ${room.number} already has a ${type.name.toLowerCase()} task today`,
        { reason: "TASK_EXISTS" },
      );
    }
    const attendant = input.assigneeId ? await requireAttendant(tx, ctx, input.assigneeId) : null;
    const task = await insertTask(tx, {
      propertyId: ctx.propertyId,
      roomId: room.id,
      taskTypeId: type.id,
      businessDate: date,
      priority: PRIORITY_VALUES[input.priority],
      credits: type.credits,
      attendantId: attendant?.id ?? null,
      notes: input.notes || null,
    });
    await audit(tx, ctx, businessDate, {
      action: "housekeeping.task_create",
      resourceType: "HousekeepingTask",
      resourceId: task.id,
      after: {
        roomId: room.id,
        roomNumber: room.number,
        taskType: type.code,
        priority: input.priority,
        attendant: attendant?.name ?? null,
      },
      permission: "housekeeping:assign",
    });
    return task.id;
  });
  return getTask(ctx, taskId);
}

export async function assignTask(
  ctx: PropertyContext,
  taskId: string,
  input: AssignTaskInput,
): Promise<TaskView> {
  requirePermission(ctx, "housekeeping:assign");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const task = await lockTaskOrThrow(tx, ctx, taskId, input.version);
    assertTaskTransition("assign", task.status);
    const attendant = input.assigneeId ? await requireAttendant(tx, ctx, input.assigneeId) : null;
    if ((attendant?.id ?? null) === task.attendant_id) {
      throw new AppError("VALIDATION_FAILED", "The task is already assigned to this person", {
        fields: { assigneeId: ["No change"] },
      });
    }
    await saveTask(tx, task, {
      attendantId: attendant?.id ?? null,
      ...(input.notes ? { notes: input.notes } : {}),
    });
    await audit(tx, ctx, businessDate, {
      action: "housekeeping.task_assign",
      resourceType: "HousekeepingTask",
      resourceId: task.id,
      before: { attendant: task.attendant_name },
      after: { attendant: attendant?.name ?? null, status: task.status },
      permission: "housekeeping:assign",
    });
  });
  return getTask(ctx, taskId);
}

/**
 * start / pause / complete: the assigned attendant (or a supervisor) works
 * the task. Starting an unassigned task takes it. Completing a cleaning
 * turns a dirty room clean; the room is ready only once inspected when the
 * task type or the property requires inspection.
 */
export async function workTask(
  ctx: PropertyContext,
  taskId: string,
  action: "start" | "pause" | "complete",
  input: TaskCommandInput,
): Promise<TaskView> {
  requirePermission(ctx, "housekeeping:update");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const ref = await findTaskRef(tx, ctx.propertyId, taskId);
    if (!ref) throw notFound("Housekeeping task");
    const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [ref.roomId]);
    const room = rooms.get(ref.roomId)!;
    const task = await lockTaskOrThrow(tx, ctx, taskId, input.version);
    const next = assertTaskTransition(action, task.status);
    const problem = taskActorProblem(
      action,
      { assigneeUserId: task.attendant_user_id },
      { userId: ctx.userId, canManage: can(ctx, "housekeeping:assign") },
    );
    if (problem) throw new AppError("FORBIDDEN", problem, { reason: "NOT_TASK_OWNER" });

    const now = new Date();
    const data: Prisma.HousekeepingTaskUncheckedUpdateManyInput = { status: next };
    let attendantName = task.attendant_name;
    if (action === "start") {
      if (!task.attendant_id) {
        const attendant = await requireAttendant(tx, ctx, ctx.userId);
        data.attendantId = attendant.id;
        attendantName = attendant.name;
      }
      data.startedAt = task.started_at ?? now;
    }
    const rules = await frontOfficeRules(tx, ctx.propertyId);
    let roomChange: { from: string; to: string } | null = null;
    let awaitingInspection = false;
    if (action === "complete") {
      data.completedAt = now;
      data.completedById = ctx.userId;
      if (task.type_changes_room_status && room.housekeepingStatus !== "CLEAN") {
        if (room.housekeepingStatus === "DIRTY" || room.housekeepingStatus === "PICKUP") {
          await changeRoomStatus(
            tx,
            { propertyId: ctx.propertyId, userId: ctx.userId },
            room,
            { housekeepingStatus: "CLEAN" },
            "HOUSEKEEPING",
            businessDate,
            `${task.type_code} task completed`,
          );
          roomChange = { from: room.housekeepingStatus, to: "CLEAN" };
        }
      }
      awaitingInspection =
        task.type_changes_room_status &&
        needsInspection({
          typeRequiresInspection: task.type_requires_inspection,
          propertyRequiresInspected: rules.requireInspectedForCheckIn,
        });
    }
    if (input.notes) data.notes = input.notes;
    await saveTask(tx, task, data);
    await audit(tx, ctx, businessDate, {
      action: `housekeeping.task_${action}`,
      resourceType: "HousekeepingTask",
      resourceId: task.id,
      before: { status: task.status, roomHousekeepingStatus: room.housekeepingStatus },
      after: {
        status: next,
        roomNumber: room.number,
        attendant: attendantName,
        ...(roomChange ? { roomHousekeepingStatus: roomChange.to } : {}),
        ...(action === "complete" ? { awaitingInspection } : {}),
      },
      permission: "housekeeping:update",
    });
  });
  return getTask(ctx, taskId);
}

/** skip (service declined, attendant or supervisor) / cancel (supervisor): with a reason. */
export async function closeTask(
  ctx: PropertyContext,
  taskId: string,
  action: "skip" | "cancel",
  input: CloseTaskInput,
): Promise<TaskView> {
  requirePermission(ctx, action === "cancel" ? "housekeeping:assign" : "housekeeping:update");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const task = await lockTaskOrThrow(tx, ctx, taskId, input.version);
    const next = assertTaskTransition(action, task.status);
    if (action === "skip") {
      const problem = taskActorProblem(
        "skip",
        { assigneeUserId: task.attendant_user_id },
        { userId: ctx.userId, canManage: can(ctx, "housekeeping:assign") },
      );
      if (problem) throw new AppError("FORBIDDEN", problem, { reason: "NOT_TASK_OWNER" });
    }
    await saveTask(tx, task, { status: next });
    await audit(tx, ctx, businessDate, {
      action: `housekeeping.task_${action}`,
      resourceType: "HousekeepingTask",
      resourceId: task.id,
      before: { status: task.status },
      after: { status: next },
      reason: input.reason,
      permission: action === "cancel" ? "housekeeping:assign" : "housekeeping:update",
    });
  });
  return getTask(ctx, taskId);
}

// --- Room-level housekeeping --------------------------------------------------------------

/**
 * Inspection of a cleaned room (`housekeeping:inspect`). Pass: the room
 * becomes INSPECTED (ready when vacant and in service) and the awaiting
 * cleaning task INSPECTED. Fail: the room goes back to DIRTY and the task to
 * FAILED_INSPECTION for the attendant to redo.
 */
export async function inspectRoom(
  ctx: PropertyContext,
  roomId: string,
  input: InspectRoomInput,
): Promise<{ roomId: string; housekeepingStatus: string; taskId: string | null }> {
  requirePermission(ctx, "housekeeping:inspect");
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [roomId]);
    const room = rooms.get(roomId)!;
    if (room.version !== input.version) throw staleVersion("Room");
    const pass = input.outcome === "PASS";
    const next = assertRoomTransition(
      pass ? "inspect_pass" : "inspect_fail",
      room.housekeepingStatus,
    );
    const task = await lockTaskAwaitingInspection(tx, ctx.propertyId, room.id);
    const now = new Date();
    await changeRoomStatus(
      tx,
      { propertyId: ctx.propertyId, userId: ctx.userId },
      room,
      { housekeepingStatus: next },
      "HOUSEKEEPING",
      businessDate,
      pass ? "Inspection passed" : `Inspection failed: ${input.notes}`,
    );
    if (task) {
      const { count } = await updateTaskVersioned(
        tx,
        task.id,
        task.version,
        pass
          ? { status: "INSPECTED", inspectedAt: now, inspectedById: ctx.userId }
          : { status: "FAILED_INSPECTION", ...(input.notes ? { notes: input.notes } : {}) },
      );
      if (count !== 1) throw staleVersion("Housekeeping task");
    }
    await audit(tx, ctx, businessDate, {
      action: pass ? "housekeeping.room_inspect_pass" : "housekeeping.room_inspect_fail",
      resourceType: "Room",
      resourceId: room.id,
      before: { housekeepingStatus: room.housekeepingStatus },
      after: { housekeepingStatus: next, roomNumber: room.number, taskId: task?.id ?? null },
      reason: input.notes ?? null,
      permission: "housekeeping:inspect",
    });
    return { roomId: room.id, housekeepingStatus: next, taskId: task?.id ?? null };
  });
}

/**
 * Housekeeping corrections without a task: mark a room dirty
 * (`housekeeping:update`, e.g. a used vacant room) or clean (supervisor,
 * `housekeeping:assign`: bypasses the task, never the inspection).
 */
export async function setRoomHousekeeping(
  ctx: PropertyContext,
  roomId: string,
  action: "mark_dirty" | "mark_clean",
  input: RoomHousekeepingInput,
): Promise<{ roomId: string; housekeepingStatus: string }> {
  requirePermission(ctx, action === "mark_clean" ? "housekeeping:assign" : "housekeeping:update");
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [roomId]);
    const room = rooms.get(roomId)!;
    if (room.version !== input.version) throw staleVersion("Room");
    const next = assertRoomTransition(action, room.housekeepingStatus);
    await changeRoomStatus(
      tx,
      { propertyId: ctx.propertyId, userId: ctx.userId },
      room,
      { housekeepingStatus: next },
      "HOUSEKEEPING",
      businessDate,
      input.notes ?? null,
    );
    await audit(tx, ctx, businessDate, {
      action: `housekeeping.room_${action}`,
      resourceType: "Room",
      resourceId: room.id,
      before: { housekeepingStatus: room.housekeepingStatus },
      after: { housekeepingStatus: next, roomNumber: room.number },
      reason: input.notes ?? null,
      permission: action === "mark_clean" ? "housekeeping:assign" : "housekeeping:update",
    });
    return { roomId: room.id, housekeepingStatus: next };
  });
}

// --- Queries ------------------------------------------------------------------------------

/** Cleaned rooms waiting for inspection (task type or property rule), as a query condition. */
function awaitingInspectionWhere(
  propertyRequiresInspected: boolean,
): Prisma.HousekeepingTaskWhereInput {
  return {
    status: "COMPLETED",
    room: { housekeepingStatus: "CLEAN" },
    taskType: propertyRequiresInspected
      ? { changesRoomStatus: true }
      : { changesRoomStatus: true, requiresInspection: true },
  };
}

async function toTaskViews(
  ctx: PropertyContext,
  rows: TaskRow[],
  businessDate: string,
): Promise<TaskView[]> {
  const rules = await frontOfficeRules(prisma, ctx.propertyId);
  const date = fromDateOnly(businessDate);
  const roomIds = [...new Set(rows.map((r) => r.room.id))];
  const arrivals = await findRoomsWithArrival(prisma, ctx.propertyId, roomIds, date);
  const blocked = await findBlockedRooms(prisma, roomIds, date);
  const names = await userDisplayNames(
    prisma,
    ctx.organizationId,
    rows.flatMap((r) => [r.completedById, r.inspectedById]).filter((id): id is string => !!id),
  );
  const manage = can(ctx, "housekeeping:assign");
  const update = can(ctx, "housekeeping:update");
  const inspect = can(ctx, "housekeeping:inspect");
  return rows.map((row) => {
    const status = row.status as TaskStatus;
    const mine = row.attendant?.userId === ctx.userId;
    const allowed = (action: TaskAction) => "next" in taskTransition(action, status);
    const worker = (action: "start" | "pause" | "complete" | "skip") =>
      update &&
      allowed(action) &&
      taskActorProblem(
        action,
        { assigneeUserId: row.attendant?.userId ?? null },
        { userId: ctx.userId, canManage: manage },
      ) === null;
    const awaitingInspection =
      status === "COMPLETED" &&
      needsInspection({
        typeRequiresInspection: row.taskType.requiresInspection,
        propertyRequiresInspected: rules.requireInspectedForCheckIn,
      }) &&
      row.room.housekeepingStatus === "CLEAN";
    const block = blocked.get(row.room.id);
    return {
      id: row.id,
      version: row.version,
      businessDate: toDateOnly(row.businessDate),
      status,
      priority: priorityLabel(row.priority),
      room: {
        id: row.room.id,
        number: row.room.number,
        floor: row.room.floor?.name ?? null,
        roomTypeCode: row.room.roomType.code,
        housekeepingStatus: row.room.housekeepingStatus,
        frontOfficeStatus: row.room.frontOfficeStatus,
        version: row.room.version,
        readiness: roomReadiness(
          {
            housekeepingStatus: row.room.housekeepingStatus,
            frontOfficeStatus: row.room.frontOfficeStatus,
            outOfOrder: block === "OUT_OF_ORDER",
            outOfService: block === "OUT_OF_SERVICE",
          },
          rules.requireInspectedForCheckIn,
        ),
      },
      type: row.taskType,
      attendant: row.attendant,
      mine,
      arrivingToday: arrivals.has(row.room.id),
      awaitingInspection,
      notes: row.notes,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedBy: row.completedById ? (names.get(row.completedById) ?? null) : null,
      inspectedAt: row.inspectedAt?.toISOString() ?? null,
      inspectedBy: row.inspectedById ? (names.get(row.inspectedById) ?? null) : null,
      allowedActions: {
        assign: manage && allowed("assign"),
        start: worker("start"),
        pause: worker("pause"),
        complete: worker("complete"),
        skip: worker("skip"),
        cancel: manage && allowed("cancel"),
        inspect: inspect && awaitingInspection,
      },
    };
  });
}

/**
 * Tasks of the business date plus open tasks carried over from earlier
 * dates, most urgent first. Views: open, mine (assigned to the caller),
 * inspections (cleaned, awaiting inspection), all.
 */
export async function listTasks(
  ctx: PropertyContext,
  query: TasksQuery,
): Promise<{ items: TaskView[]; meta: CursorPageMeta }> {
  const businessDate = requireBusinessDate(ctx);
  const date = fromDateOnly(businessDate);
  const open = { in: [...OPEN_TASK_STATUSES] };
  const where: Prisma.HousekeepingTaskWhereInput = {
    propertyId: ctx.propertyId,
    OR: [{ businessDate: date }, { businessDate: { lt: date }, status: open }],
    ...(query.roomId ? { roomId: query.roomId } : {}),
  };
  const and: Prisma.HousekeepingTaskWhereInput[] = [];
  if (query.view === "open") and.push({ status: open });
  if (query.view === "mine") and.push({ status: open, attendant: { userId: ctx.userId } });
  if (query.view === "inspections") {
    const rules = await frontOfficeRules(prisma, ctx.propertyId);
    and.push(awaitingInspectionWhere(rules.requireInspectedForCheckIn));
  }
  if (query.status) and.push({ status: query.status });
  const cursor = query.cursor ? decodeTaskCursor(query.cursor) : null;
  const rows = await findTasksPage(prisma, { ...where, AND: and }, cursor, query.limit);
  const hasMore = rows.length > query.limit;
  const visible = hasMore ? rows.slice(0, query.limit) : rows;
  const items = await toTaskViews(ctx, visible, businessDate);
  const last = visible[visible.length - 1];
  return {
    items,
    meta: {
      nextCursor: hasMore && last ? Buffer.from(last.id).toString("base64url") : null,
      limit: query.limit,
    },
  };
}

function decodeTaskCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("VALIDATION_FAILED", "Invalid cursor");
  return id;
}

export async function getTask(ctx: PropertyContext, taskId: string): Promise<TaskView> {
  const businessDate = requireBusinessDate(ctx);
  const row = await findTask(prisma, ctx.propertyId, taskId);
  if (!row) throw notFound("Housekeeping task");
  const [view] = await toTaskViews(ctx, [row], businessDate);
  return view!;
}

export async function getHousekeepingSummary(ctx: PropertyContext): Promise<HousekeepingSummary> {
  const businessDate = requireBusinessDate(ctx);
  const attendant = await findAttendantByUser(prisma, ctx.propertyId, ctx.userId);
  const { grouped, unassigned, mine } = await countTasks(
    prisma,
    ctx.propertyId,
    fromDateOnly(businessDate),
    attendant?.id ?? null,
  );
  const count = (status: TaskStatus) => grouped.find((g) => g.status === status)?._count._all ?? 0;
  const rules = await frontOfficeRules(prisma, ctx.propertyId);
  const awaiting = await prisma.housekeepingTask.count({
    where: {
      propertyId: ctx.propertyId,
      ...awaitingInspectionWhere(rules.requireInspectedForCheckIn),
    },
  });
  return {
    businessDate,
    tasks: {
      open: OPEN_TASK_STATUSES.reduce((n, s) => n + count(s), 0),
      pending: count("PENDING") + count("FAILED_INSPECTION"),
      inProgress: count("IN_PROGRESS") + count("PAUSED"),
      awaitingInspection: awaiting,
      completedToday: count("COMPLETED") + count("INSPECTED"),
      mine,
      unassigned,
    },
  };
}

export async function listTaskTypes(ctx: PropertyContext): Promise<TaskTypeView[]> {
  const types = await findTaskTypes(prisma, ctx.propertyId);
  return types.map(({ credits: _credits, ...type }) => type);
}

/** Users who can be given housekeeping work (hold housekeeping:update at the property). */
export async function listAssignees(ctx: PropertyContext): Promise<AssigneeView[]> {
  return usersWithPermission(prisma, ctx.organizationId, ctx.propertyId, "housekeeping:update");
}

// --- Night audit (Phase 8) ------------------------------------------------------------------

export const STAYOVER_CLEAN_TYPE = "STAY";

/**
 * Night audit's task roll into `nextDate` (D+1) inside the audit
 * transaction (DOMAIN_MODEL §6.6: tasks belong to one business date).
 * Open tasks of the closing date and earlier are cancelled; the work that
 * remains is re-created for the new date: a cleaning task for every vacant
 * dirty room (unfinished cleans, rooms back from service), and a stayover
 * clean for every room whose guest stays past the new date. Tasks already
 * awaiting inspection are left alone.
 */
export async function rollTasksInTx(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  nextDate: string,
): Promise<{ cancelled: number; cleaning: number; stayovers: number }> {
  const open = [...OPEN_TASK_STATUSES];
  const cancelled = await tx.$executeRaw`
    UPDATE "housekeeping_tasks"
    SET "status" = 'CANCELLED',
        "notes" = left(concat_ws(' · ', "notes", 'Closed by night audit'), 2000),
        "version" = "version" + 1, "updated_at" = now()
    WHERE "property_id" = ${ctx.propertyId}::uuid
      AND "business_date" <= ${businessDate}::date
      AND "status"::text = ANY(${open}::text[])`;

  let cleaning = 0;
  const dirtyVacant = await tx.room.findMany({
    where: {
      propertyId: ctx.propertyId,
      status: "ACTIVE",
      frontOfficeStatus: "VACANT",
      housekeepingStatus: "DIRTY",
      serviceStatus: "IN_SERVICE",
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  for (const room of dirtyVacant) {
    const queued = await queueCleaningInTx(tx, ctx, nextDate, {
      roomId: room.id,
      note: `Carried over by night audit ${businessDate}`,
    });
    if (queued) cleaning += 1;
  }

  let stayovers = 0;
  const type = await findTaskType(tx, ctx.propertyId, { code: STAYOVER_CLEAN_TYPE });
  if (type) {
    const staying = await tx.$queryRaw<{ room_id: string; stay_id: string }[]>`
      SELECT s."room_id", s."id" AS "stay_id"
      FROM "stays" s
      JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
      WHERE s."property_id" = ${ctx.propertyId}::uuid AND s."status" = 'IN_HOUSE'
        AND rr."departure_date" > ${nextDate}::date
      ORDER BY s."room_id"`;
    const date = fromDateOnly(nextDate);
    for (const row of staying) {
      if (await findLiveTask(tx, ctx.propertyId, row.room_id, date, type.id)) continue;
      await insertTask(tx, {
        propertyId: ctx.propertyId,
        roomId: row.room_id,
        taskTypeId: type.id,
        businessDate: date,
        priority: PRIORITY_VALUES.NORMAL,
        credits: type.credits,
        stayId: row.stay_id,
        notes: "Stayover",
      });
      stayovers += 1;
    }
  }
  return { cancelled, cleaning, stayovers };
}
