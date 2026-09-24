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
import { toDateOnly } from "@/modules/business-date/business-date.policy";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { queueCleaningInTx } from "@/modules/housekeeping/housekeeping.service";
import { allocateNumber } from "@/modules/properties/properties.service";
import { serviceReasonCodes } from "@/modules/rooms/room-operations.service";
import { placeServiceBlock, releaseServiceBlock } from "@/modules/rooms/rooms.service";
import type { CursorPageMeta } from "@/types/api";
import {
  ACTIVE_MAINTENANCE_STATUSES,
  type MaintenanceAction,
  type MaintenancePriority,
  type MaintenanceStatus,
  maintenanceActorProblem,
  maintenanceTransition,
} from "./maintenance.policy";
import {
  type LockedRequestRow,
  type RequestListRow,
  countOpenRequests,
  findActiveRoom,
  findCategories,
  findCategory,
  findRequestDetail,
  findRequestsPage,
  insertActivity,
  insertRequest,
  lockRequest,
  updateRequestVersioned,
} from "./maintenance.repository";
import type {
  AssignRequestInput,
  BlockRequestRoomInput,
  CancelRequestInput,
  CreateRequestInput,
  NoteInput,
  RequestCommandInput,
  RequestsQuery,
  ResolveRequestInput,
} from "./maintenance.schema";
import type {
  MaintenanceDetail,
  MaintenanceListItem,
  MaintenanceOptions,
} from "./maintenance.types";

/**
 * Maintenance (docs/PMS_WORKFLOWS.md §29): room and public-area requests
 * with assignment, work status, priority and resolution.
 *
 * A request never changes room readiness by itself. A blocking issue places
 * an out-of-order / out-of-service block linked to the request (removing the
 * room from assignment and, for out of order, from inventory). Resolving the
 * request may return the room to service: it comes back DIRTY with a
 * priority cleaning task, so it is ready only after housekeeping (and
 * inspection where required).
 *
 * Lock order: business date → request → property sequence → inventory →
 * rooms → housekeeping task. Every command writes a maintenance activity and
 * an audit record.
 */

function requirePermission(ctx: PropertyContext, permission: Permission) {
  if (!hasPermission(ctx.access, ctx.propertyId, permission)) throw forbidden(permission);
}

const can = (ctx: PropertyContext, permission: Permission) =>
  hasPermission(ctx.access, ctx.propertyId, permission);

async function lockRequestOrThrow(tx: Tx, ctx: PropertyContext, id: string, version: number) {
  const request = await lockRequest(tx, ctx.propertyId, id);
  if (!request) throw notFound("Maintenance request");
  if (request.version !== version) throw staleVersion("Maintenance request");
  return request;
}

function assertTransition(action: MaintenanceAction, status: MaintenanceStatus) {
  const result = maintenanceTransition(action, status);
  if ("problem" in result) {
    throw new AppError("INVALID_STATE_TRANSITION", result.problem, { action, status });
  }
  return result.next;
}

async function requireAssignee(tx: Tx, ctx: PropertyContext, userId: string) {
  const user = await userHasPermission(
    tx,
    ctx.organizationId,
    ctx.propertyId,
    userId,
    "maintenance:update",
  );
  if (!user) {
    throw new AppError("VALIDATION_FAILED", "The assignee cannot work maintenance here", {
      fields: { assigneeId: ["Choose a maintenance user of this property"] },
    });
  }
  return user;
}

async function save(
  tx: Tx,
  request: LockedRequestRow,
  data: Prisma.MaintenanceRequestUncheckedUpdateManyInput,
) {
  const { count } = await updateRequestVersioned(tx, request.id, request.version, data);
  if (count !== 1) throw staleVersion("Maintenance request");
}

async function activity(
  tx: Tx,
  ctx: PropertyContext,
  requestId: string,
  entry: {
    type: "NOTE" | "STATUS_CHANGE" | "ASSIGNMENT";
    body?: string | null;
    from?: MaintenanceStatus;
    to?: MaintenanceStatus;
  },
) {
  await insertActivity(tx, {
    propertyId: ctx.propertyId,
    requestId,
    type: entry.type,
    body: entry.body ?? null,
    fromStatus: entry.from ?? null,
    toStatus: entry.to ?? null,
    createdById: ctx.userId,
  });
}

/** Places the linked room block and records it (request already locked). */
async function blockRoomForRequest(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  request: { id: string; roomId: string },
  block: { kind: "OUT_OF_ORDER" | "OUT_OF_SERVICE"; to: string; reasonCodeId: string },
  reason: string,
) {
  requirePermission(ctx, "rooms:out_of_order");
  const placed = await placeServiceBlock(tx, ctx, businessDate, {
    roomId: request.roomId,
    kind: block.kind,
    from: businessDate,
    to: block.to,
    reasonCodeId: block.reasonCodeId,
    maintenanceRequestId: request.id,
    reason,
  });
  await activity(tx, ctx, request.id, {
    type: "NOTE",
    body: `Room ${placed.roomNumber} ${block.kind === "OUT_OF_ORDER" ? "out of order" : "out of service"} until ${block.to}: ${reason}`,
  });
  return placed;
}

// --- Commands -------------------------------------------------------------------------------

export async function createRequest(
  ctx: PropertyContext,
  input: CreateRequestInput,
): Promise<MaintenanceDetail> {
  requirePermission(ctx, "maintenance:create");
  if (input.assigneeId) requirePermission(ctx, "maintenance:manage");
  const id = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const category = await findCategory(tx, ctx.propertyId, input.categoryId);
    if (!category) throw notFound("Maintenance category");
    const room = input.roomId ? await findActiveRoom(tx, ctx.propertyId, input.roomId) : null;
    if (input.roomId && !room) throw notFound("Room");
    const assignee = input.assigneeId ? await requireAssignee(tx, ctx, input.assigneeId) : null;
    const requestNumber = await allocateNumber(tx, ctx.propertyId, "maintenance");
    const status: MaintenanceStatus = assignee ? "ASSIGNED" : "OPEN";
    const created = await insertRequest(tx, {
      propertyId: ctx.propertyId,
      requestNumber,
      roomId: room?.id ?? null,
      location: input.location ?? null,
      categoryId: category.id,
      title: input.title,
      description: input.description || null,
      priority: input.priority,
      status,
      assignedToId: assignee?.id ?? null,
      reportedById: ctx.userId,
    });
    await activity(tx, ctx, created.id, {
      type: "STATUS_CHANGE",
      to: status,
      body: assignee ? `Reported and assigned to ${assignee.displayName}` : "Reported",
    });
    const blocked =
      input.blockRoom && room
        ? await blockRoomForRequest(
            tx,
            ctx,
            businessDate,
            { id: created.id, roomId: room.id },
            input.blockRoom,
            input.reason!,
          )
        : null;
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "maintenance.create",
        resourceType: "MaintenanceRequest",
        resourceId: created.id,
        risk: blocked ? "HIGH" : "STANDARD",
        after: {
          requestNumber,
          title: input.title,
          priority: input.priority,
          status,
          roomNumber: room?.number ?? null,
          location: input.location ?? null,
          assignee: assignee?.displayName ?? null,
          ...(blocked ? { roomBlock: input.blockRoom!.kind, blockUntil: input.blockRoom!.to } : {}),
        },
        reason: input.reason ?? null,
        permission: blocked ? "rooms:out_of_order" : "maintenance:create",
      },
    );
    return created.id;
  });
  return getRequest(ctx, id);
}

export async function assignRequest(
  ctx: PropertyContext,
  requestId: string,
  input: AssignRequestInput,
): Promise<MaintenanceDetail> {
  requirePermission(ctx, "maintenance:manage");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const request = await lockRequestOrThrow(tx, ctx, requestId, input.version);
    const next = assertTransition("assign", request.status);
    if (request.assigned_to_id === input.assigneeId) {
      throw new AppError("VALIDATION_FAILED", "The request is already assigned to this person", {
        fields: { assigneeId: ["No change"] },
      });
    }
    const assignee = await requireAssignee(tx, ctx, input.assigneeId);
    await save(tx, request, { assignedToId: assignee.id, status: next });
    await activity(tx, ctx, request.id, {
      type: "ASSIGNMENT",
      body: `Assigned to ${assignee.displayName}${input.note ? `: ${input.note}` : ""}`,
      from: request.status,
      to: next,
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "maintenance.assign",
        resourceType: "MaintenanceRequest",
        resourceId: request.id,
        before: { status: request.status, assignedToId: request.assigned_to_id },
        after: { status: next, assignedToId: assignee.id, assignee: assignee.displayName },
        permission: "maintenance:manage",
      },
    );
  });
  return getRequest(ctx, requestId);
}

/** start / hold / resume: the assignee (or a manager) works the request. */
export async function workRequest(
  ctx: PropertyContext,
  requestId: string,
  action: "start" | "hold" | "resume",
  input: RequestCommandInput,
): Promise<MaintenanceDetail> {
  requirePermission(ctx, "maintenance:update");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const request = await lockRequestOrThrow(tx, ctx, requestId, input.version);
    const next = assertTransition(action, request.status);
    const problem = maintenanceActorProblem(
      action,
      { assigneeId: request.assigned_to_id },
      { userId: ctx.userId, canManage: can(ctx, "maintenance:manage") },
    );
    if (problem) throw new AppError("FORBIDDEN", problem, { reason: "NOT_ASSIGNEE" });
    const takes = action === "start" && !request.assigned_to_id;
    await save(tx, request, { status: next, ...(takes ? { assignedToId: ctx.userId } : {}) });
    await activity(tx, ctx, request.id, {
      type: "STATUS_CHANGE",
      from: request.status,
      to: next,
      body: input.note ?? null,
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: `maintenance.${action}`,
        resourceType: "MaintenanceRequest",
        resourceId: request.id,
        before: { status: request.status },
        after: { status: next, ...(takes ? { assignedToId: ctx.userId } : {}) },
        reason: input.note ?? null,
        permission: "maintenance:update",
      },
    );
  });
  return getRequest(ctx, requestId);
}

/**
 * Resolve with a resolution. With `returnToService`, the room blocks placed
 * for this request are released (`rooms:out_of_order`): the room comes back
 * DIRTY with a priority cleaning task — never directly ready.
 */
export async function resolveRequest(
  ctx: PropertyContext,
  requestId: string,
  input: ResolveRequestInput,
): Promise<MaintenanceDetail> {
  requirePermission(ctx, "maintenance:update");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const request = await lockRequestOrThrow(tx, ctx, requestId, input.version);
    const next = assertTransition("resolve", request.status);
    const problem = maintenanceActorProblem(
      "resolve",
      { assigneeId: request.assigned_to_id },
      { userId: ctx.userId, canManage: can(ctx, "maintenance:manage") },
    );
    if (problem) throw new AppError("FORBIDDEN", problem, { reason: "NOT_ASSIGNEE" });

    const detail = await findRequestDetail(tx, ctx.propertyId, request.id);
    const live = (detail?.serviceBlocks ?? []).filter(
      (b) => b.status === "SCHEDULED" || b.status === "ACTIVE",
    );
    const released: { roomNumber: string; taskId: string | null }[] = [];
    if (input.returnToService && live.length > 0) {
      requirePermission(ctx, "rooms:out_of_order");
      for (const block of live) {
        const result = await releaseServiceBlock(
          tx,
          ctx,
          businessDate,
          block.id,
          `Maintenance ${request.request_number} resolved`,
        );
        const task = result.started
          ? await queueCleaningInTx(tx, ctx, businessDate, {
              roomId: result.roomId,
              afterMaintenance: true,
              note: `After maintenance ${request.request_number}`,
            })
          : null;
        released.push({ roomNumber: result.roomNumber, taskId: task?.taskId ?? null });
      }
    }
    await save(tx, request, { status: next, resolvedAt: new Date(), resolution: input.resolution });
    await activity(tx, ctx, request.id, {
      type: "STATUS_CHANGE",
      from: request.status,
      to: next,
      body:
        input.resolution +
        (released.length
          ? ` · Room ${released.map((r) => r.roomNumber).join(", ")} returned to service for cleaning`
          : ""),
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "maintenance.resolve",
        resourceType: "MaintenanceRequest",
        resourceId: request.id,
        risk: released.length ? "HIGH" : "STANDARD",
        before: { status: request.status, liveBlocks: live.length },
        after: {
          status: next,
          returnedToService: released,
          stillBlocked: input.returnToService ? 0 : live.length,
        },
        reason: input.resolution,
        permission: released.length ? "rooms:out_of_order" : "maintenance:update",
      },
    );
  });
  return getRequest(ctx, requestId);
}

/** close (resolved → closed), reopen (resolved → in progress), cancel (with a reason): managers. */
export async function manageRequest(
  ctx: PropertyContext,
  requestId: string,
  action: "close" | "reopen" | "cancel",
  input: RequestCommandInput | CancelRequestInput,
): Promise<MaintenanceDetail> {
  requirePermission(ctx, "maintenance:manage");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const request = await lockRequestOrThrow(tx, ctx, requestId, input.version);
    const next = assertTransition(action, request.status);
    if (action === "cancel") {
      const detail = await findRequestDetail(tx, ctx.propertyId, request.id);
      if (
        (detail?.serviceBlocks ?? []).some((b) => b.status === "SCHEDULED" || b.status === "ACTIVE")
      ) {
        throw new AppError(
          "BUSINESS_RULE_VIOLATION",
          "Return the room to service before cancelling this request",
          { reason: "ROOM_STILL_BLOCKED" },
        );
      }
    }
    const note = "reason" in input ? input.reason : (input.note ?? null);
    await save(tx, request, {
      status: next,
      ...(action === "close" ? { closedAt: new Date() } : {}),
      ...(action === "reopen" ? { resolvedAt: null, resolution: null } : {}),
    });
    await activity(tx, ctx, request.id, {
      type: "STATUS_CHANGE",
      from: request.status,
      to: next,
      body: note,
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: `maintenance.${action}`,
        resourceType: "MaintenanceRequest",
        resourceId: request.id,
        before: { status: request.status },
        after: { status: next },
        reason: note,
        permission: "maintenance:manage",
      },
    );
  });
  return getRequest(ctx, requestId);
}

/** Take the request's room out of order / out of service while the work is open. */
export async function blockRequestRoom(
  ctx: PropertyContext,
  requestId: string,
  input: BlockRequestRoomInput,
): Promise<MaintenanceDetail> {
  requirePermission(ctx, "rooms:out_of_order");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const request = await lockRequestOrThrow(tx, ctx, requestId, input.version);
    if (!ACTIVE_MAINTENANCE_STATUSES.includes(request.status)) {
      throw new AppError("INVALID_STATE_TRANSITION", "Only open work can block a room", {
        status: request.status,
      });
    }
    if (!request.room_id) {
      throw new AppError("BUSINESS_RULE_VIOLATION", "This request is not for a room", {
        reason: "NO_ROOM",
      });
    }
    const placed = await blockRoomForRequest(
      tx,
      ctx,
      businessDate,
      { id: request.id, roomId: request.room_id },
      input,
      input.reason,
    );
    await save(tx, request, {});
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "maintenance.block_room",
        resourceType: "MaintenanceRequest",
        resourceId: request.id,
        risk: "HIGH",
        after: { roomNumber: placed.roomNumber, kind: input.kind, to: input.to },
        reason: input.reason,
        reasonCodeId: input.reasonCodeId,
        permission: "rooms:out_of_order",
      },
    );
  });
  return getRequest(ctx, requestId);
}

export async function addNote(
  ctx: PropertyContext,
  requestId: string,
  input: NoteInput,
): Promise<MaintenanceDetail> {
  if (!can(ctx, "maintenance:update") && !can(ctx, "maintenance:manage")) {
    throw forbidden("maintenance:update");
  }
  await runInTransaction(async (tx) => {
    const request = await lockRequest(tx, ctx.propertyId, requestId);
    if (!request) throw notFound("Maintenance request");
    await activity(tx, ctx, request.id, { type: "NOTE", body: input.body });
  });
  return getRequest(ctx, requestId);
}

// --- Queries --------------------------------------------------------------------------------

function toListItem(ctx: PropertyContext, row: RequestListRow): MaintenanceListItem {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    version: row.version,
    title: row.title,
    status: row.status,
    priority: row.priority as MaintenancePriority,
    room: row.room,
    location: row.location,
    category: row.category,
    assignee: row.assignedTo ? { id: row.assignedTo.id, name: row.assignedTo.displayName } : null,
    mine: row.assignedToId === ctx.userId,
    reportedAt: row.reportedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    roomBlocked: row.serviceBlocks[0]?.kind ?? null,
  };
}

export async function listRequests(
  ctx: PropertyContext,
  query: RequestsQuery,
): Promise<{ items: MaintenanceListItem[]; meta: CursorPageMeta }> {
  const active = { in: [...ACTIVE_MAINTENANCE_STATUSES] };
  const byView: Record<RequestsQuery["view"], Prisma.MaintenanceRequestWhereInput> = {
    open: { status: active },
    mine: { status: active, assignedToId: ctx.userId },
    in_progress: { status: { in: ["IN_PROGRESS", "ON_HOLD"] } },
    resolved: { status: "RESOLVED" },
    closed: { status: { in: ["CLOSED", "CANCELLED"] } },
    all: {},
  };
  const where: Prisma.MaintenanceRequestWhereInput = {
    propertyId: ctx.propertyId,
    ...byView[query.view],
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.roomId ? { roomId: query.roomId } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" } },
            { requestNumber: { startsWith: query.q.toUpperCase() } },
            { room: { number: query.q } },
          ],
        }
      : {}),
  };
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = await findRequestsPage(prisma, where, cursor, query.limit);
  const hasMore = rows.length > query.limit;
  const visible = hasMore ? rows.slice(0, query.limit) : rows;
  const last = visible[visible.length - 1];
  return {
    items: visible.map((row) => toListItem(ctx, row)),
    meta: {
      nextCursor: hasMore && last ? Buffer.from(last.id).toString("base64url") : null,
      limit: query.limit,
    },
  };
}

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("VALIDATION_FAILED", "Invalid cursor");
  return id;
}

export async function getRequest(
  ctx: PropertyContext,
  requestId: string,
): Promise<MaintenanceDetail> {
  const row = await findRequestDetail(prisma, ctx.propertyId, requestId);
  if (!row) throw notFound("Maintenance request");
  const names = await userDisplayNames(prisma, ctx.organizationId, [
    row.reportedById,
    ...row.activities.map((a) => a.createdById),
  ]);
  const status = row.status as MaintenanceStatus;
  const manage = can(ctx, "maintenance:manage");
  const update = can(ctx, "maintenance:update");
  const allowed = (action: MaintenanceAction) => "next" in maintenanceTransition(action, status);
  const worker = (action: "start" | "hold" | "resume" | "resolve") =>
    update &&
    allowed(action) &&
    maintenanceActorProblem(
      action,
      { assigneeId: row.assignedToId },
      { userId: ctx.userId, canManage: manage },
    ) === null;
  const live = row.serviceBlocks.filter((b) => b.status === "SCHEDULED" || b.status === "ACTIVE");
  return {
    ...toListItem(ctx, { ...row, serviceBlocks: live.slice(0, 1) }),
    description: row.description,
    reportedBy: names.get(row.reportedById) ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    resolution: row.resolution,
    blocks: row.serviceBlocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      status: b.status,
      from: toDateOnly(b.fromDate),
      to: toDateOnly(b.toDate),
    })),
    activities: row.activities.map((a) => ({
      id: a.id,
      type: a.type,
      body: a.body,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      by: names.get(a.createdById) ?? null,
      at: a.createdAt.toISOString(),
    })),
    allowedActions: {
      assign: manage && allowed("assign"),
      start: worker("start"),
      hold: worker("hold"),
      resume: worker("resume"),
      resolve: worker("resolve"),
      close: manage && allowed("close"),
      reopen: manage && allowed("reopen"),
      cancel: manage && allowed("cancel") && live.length === 0,
      blockRoom:
        can(ctx, "rooms:out_of_order") &&
        row.room !== null &&
        live.length === 0 &&
        ACTIVE_MAINTENANCE_STATUSES.includes(status),
      note: update || manage,
    },
  };
}

export async function maintenanceSummary(ctx: PropertyContext) {
  const [grouped, mine, blocking] = await countOpenRequests(prisma, ctx.propertyId, ctx.userId);
  const count = (status: MaintenanceStatus) =>
    grouped.find((g) => g.status === status)?._count._all ?? 0;
  return {
    open: ACTIVE_MAINTENANCE_STATUSES.reduce((n, s) => n + count(s), 0),
    unassigned: count("OPEN"),
    inProgress: count("IN_PROGRESS") + count("ON_HOLD"),
    resolved: count("RESOLVED"),
    mine,
    blockingRooms: blocking,
  };
}

export async function maintenanceOptions(ctx: PropertyContext): Promise<MaintenanceOptions> {
  const categories = await findCategories(prisma, ctx.propertyId);
  const assignees = await usersWithPermission(
    prisma,
    ctx.organizationId,
    ctx.propertyId,
    "maintenance:update",
  );
  const blockReasons = can(ctx, "rooms:out_of_order") ? await serviceReasonCodes(ctx) : [];
  return { categories, assignees, blockReasons };
}
