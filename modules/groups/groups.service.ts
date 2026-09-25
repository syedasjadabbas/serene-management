import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { type IdempotencyRequest, type PropertyContext, auditActor } from "@/lib/http/context";
import { AppError, forbidden, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasPermission } from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { recordAudit } from "@/modules/audit/audit.service";
import type { AuditActor } from "@/modules/audit/audit.types";
import { availableForNight } from "@/modules/availability/availability.policy";
import {
  type InventoryDemand,
  loadNightInventory,
  lockInventoryForRelease,
  syncInventoryCounters,
} from "@/modules/availability/availability.service";
import { addDays, fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { requireGuest } from "@/modules/guests/guests.service";
import { runIdempotent } from "@/modules/idempotency/idempotency.service";
import { stayNights } from "@/modules/reservations/reservations.policy";
import { createReservationInTx } from "@/modules/reservations/reservations.service";
import {
  type BlockNight,
  type BlockStatusType,
  allocationProblem,
  blockTotals,
  blockTransitionProblem,
  remainingRooms,
  stayWithinBlock,
} from "./groups.policy";
import {
  type BlockRow,
  type GridRow,
  countActivePickup,
  countGroupPickup,
  findBlock,
  findBlockGrid,
  findBlockStatus,
  findBlocksOfGroup,
  findCancelStatus,
  findGroup,
  findGroupOptions,
  findGroupReservations,
  findGroupsPage,
  findPlanRoomTypes,
  insertBlock,
  insertGroup,
  lockBlock,
  lockBlockShare,
  lockGroup,
  setReleased,
  updateBlockVersioned,
  updateGroupRow,
  upsertAllocation,
} from "./groups.repository";
import type {
  AllocationInput,
  BlockStatusInput,
  CreateBlockInput,
  CreateGroupInput,
  GroupStatusInput,
  GroupsQuery,
  PickupInput,
  ReleaseInput,
  UpdateGroupInput,
} from "./groups.schema";
import type {
  BlockView,
  GroupDetail,
  GroupListItem,
  GroupOptions,
  PickupResult,
  ReleaseResult,
} from "./groups.types";

/**
 * Groups, blocks and pickup (docs/PMS_WORKFLOWS.md §18; docs/DOMAIN_MODEL.md
 * §6.8). A group is managed from one property; its blocks hold room types
 * per night. Inventory is never counted twice: a DEDUCT block holds
 * `allocated − released − picked up` out of house availability, and a
 * pickup reservation's nights are sold, so picking up a room inside the
 * allocation leaves house availability unchanged.
 *
 * Lock order (ARCHITECTURE §5): business date → idempotency key → block
 * (FOR UPDATE for block commands, FOR SHARE for pickups) → rate plan (FOR
 * SHARE, pricing) → inventory cells → block allocation rows → sequences.
 */

function can(ctx: PropertyContext, permission: Permission) {
  return hasPermission(ctx.access, ctx.propertyId, permission);
}

function requirePermission(ctx: PropertyContext, permission: Permission) {
  if (!can(ctx, permission)) throw forbidden(permission);
}

function rule(message: string, reason: string, details: Record<string, unknown> = {}) {
  return new AppError("BUSINESS_RULE_VIOLATION", message, { reason, ...details });
}

function fieldError(field: string, message: string) {
  return new AppError("VALIDATION_FAILED", message, { fields: { [field]: [message] } });
}

const guestName = (g: { firstName: string; lastName: string } | null) =>
  g ? `${g.lastName}, ${g.firstName}` : null;

function demandsOf(
  block: { startDate: Date; endDate: Date },
  roomTypeIds: string[],
): InventoryDemand[] {
  return roomTypeIds.map((roomTypeId) => ({
    roomTypeId,
    arrival: toDateOnly(block.startDate),
    departure: toDateOnly(block.endDate),
    rooms: 1,
  }));
}

function nightsOf(grid: GridRow[], blockId: string, roomTypeId: string): Map<string, BlockNight> {
  return new Map(
    grid
      .filter((row) => row.block_id === blockId && row.room_type_id === roomTypeId)
      .map((row) => [
        toDateOnly(row.stay_date),
        {
          date: toDateOnly(row.stay_date),
          allocated: row.allocated,
          released: row.released,
          pickedUp: row.picked,
        },
      ]),
  );
}

/**
 * A definite block may hold only what the house can spare: for every
 * (room type, night) the rooms it still holds must fit house availability
 * computed without this block (its own pickups are already sold).
 */
async function assertHouseCovers(
  tx: Tx,
  ctx: PropertyContext,
  block: { id: string; startDate: Date; endDate: Date },
  holding: Map<string, Map<string, BlockNight>>,
  override: boolean,
) {
  const short: { roomTypeId: string; date: string; needed: number; available: number }[] = [];
  for (const [roomTypeId, nights] of holding) {
    const house =
      (
        await loadNightInventory(
          tx,
          ctx.propertyId,
          [roomTypeId],
          toDateOnly(block.startDate),
          toDateOnly(block.endDate),
          [],
          block.id,
        )
      ).get(roomTypeId) ?? [];
    for (const night of house) {
      const held = nights.get(night.date);
      if (!held) continue;
      const needed = remainingRooms(held);
      const available = Math.max(0, availableForNight(night));
      if (needed > available) short.push({ roomTypeId, date: night.date, needed, available });
    }
  }
  if (short.length > 0 && !override) {
    throw rule("The hotel does not have enough rooms to hold this block", "BLOCK_NO_AVAILABILITY", {
      nights: short,
    });
  }
  return short;
}

// --- Views --------------------------------------------------------------------------

function blockView(block: BlockRow, grid: GridRow[]): BlockView {
  const types = new Map<string, { code: string; name: string }>();
  for (const row of grid.filter((r) => r.block_id === block.id)) {
    types.set(row.room_type_id, { code: row.room_type_code, name: row.room_type_name });
  }
  const roomTypes = [...types].map(([id, type]) => {
    const nights = [...nightsOf(grid, block.id, id).values()].map((n) => ({
      ...n,
      remaining: remainingRooms(n),
    }));
    return { roomType: { id, ...type }, totals: blockTotals(nights), nights };
  });
  return {
    id: block.id,
    code: block.code,
    name: block.name,
    version: block.version,
    status: block.status,
    startDate: toDateOnly(block.startDate),
    endDate: toDateOnly(block.endDate),
    cutoffDate: block.cutoffDate ? toDateOnly(block.cutoffDate) : null,
    isElastic: block.isElastic,
    ratePlan: block.ratePlan,
    reservationType: block.reservationType,
    totals: blockTotals(roomTypes.flatMap((rt) => rt.nights)),
    roomTypes,
  };
}

export async function listGroups(
  ctx: PropertyContext,
  query: GroupsQuery,
): Promise<{ items: GroupListItem[]; nextCursor: string | null }> {
  let cursor: { v: string; i: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor, ["v", "i"] as const);
    if (!cursor) throw fieldError("cursor", "Invalid cursor");
  }
  const rows = await findGroupsPage(prisma, ctx.propertyId, {
    status: query.status,
    q: query.q,
    cursor,
    limit: query.limit,
  });
  const page = rows.slice(0, query.limit);
  const picked = new Map(
    (
      await countGroupPickup(
        prisma,
        page.map((r) => r.id),
      )
    ).map((r) => [r.group_id, r.picked]),
  );
  const last = page.at(-1);
  return {
    items: page.map((row) => {
      const pickedUp = picked.get(row.id) ?? 0;
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        account: row.account,
        contact: row.contact_last ? `${row.contact_last}, ${row.contact_first}` : null,
        blocks: row.blocks,
        firstNight: row.first_night ? toDateOnly(row.first_night) : null,
        departure: row.departure ? toDateOnly(row.departure) : null,
        totals: {
          allocated: row.allocated,
          pickedUp,
          released: row.released,
          remaining: Math.max(0, row.allocated - row.released - pickedUp),
        },
      };
    }),
    nextCursor:
      rows.length > query.limit && last ? encodeCursor({ v: last.code, i: last.id }) : null,
  };
}

export async function getGroup(ctx: PropertyContext, groupId: string): Promise<GroupDetail> {
  const group = await findGroup(prisma, ctx.propertyId, groupId);
  if (!group) throw notFound("Group");
  const blocks = await findBlocksOfGroup(prisma, ctx.propertyId, groupId);
  const grid = await findBlockGrid(
    prisma,
    blocks.map((b) => b.id),
  );
  const reservations = await findGroupReservations(prisma, ctx.propertyId, groupId);
  return {
    id: group.id,
    code: group.code,
    name: group.name,
    status: group.status,
    notes: group.notes,
    account: group.account,
    contact: group.contactGuest
      ? { id: group.contactGuest.id, name: guestName(group.contactGuest)! }
      : null,
    createdAt: group.createdAt.toISOString(),
    businessDate: ctx.businessDate,
    blocks: blocks.map((block) => blockView(block, grid)),
    reservations: reservations.map((rr) => ({
      reservationRoomId: rr.id,
      reservationId: rr.reservationId,
      confirmation: `${rr.reservation.confirmationNumber}-${rr.lineNumber}`,
      guestName: guestName(rr.primaryGuest)!,
      roomType: rr.roomType.code,
      arrival: toDateOnly(rr.arrivalDate),
      departure: toDateOnly(rr.departureDate),
      rooms: 1,
      status: rr.status,
      blockCode: rr.block?.code ?? null,
    })),
    actions: {
      manage: can(ctx, "groups:manage") && group.status === "ACTIVE",
      pickup: can(ctx, "reservations:create") && group.status === "ACTIVE",
    },
  };
}

export async function groupOptions(ctx: PropertyContext): Promise<GroupOptions> {
  return { businessDate: ctx.businessDate, ...(await findGroupOptions(prisma, ctx.propertyId)) };
}

// --- Groups -------------------------------------------------------------------------

async function validateGroupRefs(
  tx: Tx,
  ctx: PropertyContext,
  input: { accountProfileId?: string | null; contactGuestId?: string | null },
) {
  if (input.accountProfileId) {
    const account = await tx.accountProfile.findFirst({
      where: { id: input.accountProfileId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!account) throw fieldError("accountProfileId", "Unknown company or agent");
  }
  if (input.contactGuestId) await requireGuest(tx, ctx.organizationId, input.contactGuestId);
}

export async function createGroup(
  ctx: PropertyContext,
  input: CreateGroupInput,
): Promise<GroupDetail> {
  const id = await runInTransaction(async (tx) => {
    await validateGroupRefs(tx, ctx, input);
    const existing = await tx.group.findFirst({
      where: { organizationId: ctx.organizationId, code: input.code },
      select: { id: true },
    });
    if (existing) throw fieldError("code", `Group ${input.code} already exists`);
    const group = await insertGroup(tx, {
      organizationId: ctx.organizationId,
      propertyId: ctx.propertyId,
      code: input.code,
      name: input.name,
      accountProfileId: input.accountProfileId ?? null,
      contactGuestId: input.contactGuestId ?? null,
      salesOwnerId: ctx.userId,
      notes: input.notes ?? null,
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "group.create",
        resourceType: "Group",
        resourceId: group.id,
        after: {
          code: input.code,
          name: input.name,
          accountProfileId: input.accountProfileId ?? null,
        },
        permission: "groups:manage",
      },
    );
    return group.id;
  });
  return getGroup(ctx, id);
}

export async function updateGroup(
  ctx: PropertyContext,
  groupId: string,
  input: UpdateGroupInput,
): Promise<GroupDetail> {
  await runInTransaction(async (tx) => {
    const locked = await lockGroup(tx, ctx.propertyId, groupId);
    if (!locked) throw notFound("Group");
    if (locked.status !== "ACTIVE")
      throw rule("Only an active group can be changed", "GROUP_NOT_ACTIVE");
    await validateGroupRefs(tx, ctx, input);
    const before = await findGroup(tx, ctx.propertyId, groupId);
    await updateGroupRow(tx, groupId, {
      name: input.name,
      accountProfileId: input.accountProfileId ?? null,
      contactGuestId: input.contactGuestId ?? null,
      notes: input.notes ?? null,
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "group.update",
        resourceType: "Group",
        resourceId: groupId,
        before: {
          name: before!.name,
          accountProfileId: before!.account?.id ?? null,
          notes: before!.notes,
        },
        after: {
          name: input.name,
          accountProfileId: input.accountProfileId ?? null,
          notes: input.notes ?? null,
        },
        permission: "groups:manage",
      },
    );
  });
  return getGroup(ctx, groupId);
}

/**
 * Closes or cancels a group. Cancelling requires every block to be without
 * active pickup; its blocks move to the property's CANCEL status, which
 * returns what they held to house inventory.
 */
export async function changeGroupStatus(
  ctx: PropertyContext,
  groupId: string,
  input: GroupStatusInput,
): Promise<GroupDetail> {
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const locked = await lockGroup(tx, ctx.propertyId, groupId);
    if (!locked) throw notFound("Group");
    if (locked.status !== "ACTIVE") throw rule("The group is already closed", "GROUP_NOT_ACTIVE");
    const blocks = await findBlocksOfGroup(tx, ctx.propertyId, groupId);
    const cancelled: string[] = [];
    if (input.status === "CANCELLED") {
      const cancel = await findCancelStatus(tx, ctx.propertyId);
      if (!cancel) throw rule("No cancelled block status is configured", "NO_CANCEL_STATUS");
      for (const block of blocks) {
        if (block.status.type === "CANCEL") continue;
        await lockBlock(tx, ctx.propertyId, block.id);
        if ((await countActivePickup(tx, block.id)) > 0) {
          throw rule(
            `Block ${block.code} has picked-up reservations; cancel them first`,
            "BLOCK_HAS_PICKUP",
          );
        }
        const grid = await findBlockGrid(tx, [block.id]);
        const roomTypeIds = [...new Set(grid.map((r) => r.room_type_id))];
        const demands = demandsOf(block, roomTypeIds);
        await lockInventoryForRelease(tx, ctx.propertyId, demands);
        await updateBlockVersioned(tx, block.id, block.version, { statusId: cancel.id });
        await syncInventoryCounters(tx, ctx.propertyId, demands);
        cancelled.push(block.code);
      }
    }
    await updateGroupRow(tx, groupId, { status: input.status });
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: input.status === "CANCELLED" ? "group.cancel" : "group.close",
        resourceType: "Group",
        resourceId: groupId,
        before: { status: "ACTIVE" },
        after: { status: input.status, cancelledBlocks: cancelled },
        reason: input.reason,
        permission: "groups:manage",
      },
    );
  });
  return getGroup(ctx, groupId);
}

// --- Blocks -------------------------------------------------------------------------

export async function createBlock(
  ctx: PropertyContext,
  groupId: string,
  input: CreateBlockInput,
): Promise<GroupDetail> {
  if (input.override) requirePermission(ctx, "reservations:override_availability");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const group = await lockGroup(tx, ctx.propertyId, groupId);
    if (!group) throw notFound("Group");
    if (group.status !== "ACTIVE")
      throw rule("Blocks can be added to an active group only", "GROUP_NOT_ACTIVE");
    if (input.startDate < businessDate) {
      throw fieldError("startDate", `The first night must be on or after ${businessDate}`);
    }
    if (
      await tx.block.findFirst({
        where: { propertyId: ctx.propertyId, code: input.code },
        select: { id: true },
      })
    ) {
      throw fieldError("code", `Block ${input.code} already exists`);
    }
    const status = await findBlockStatus(tx, ctx.propertyId, input.statusId);
    if (!status) throw fieldError("statusId", "Unknown block status");
    if (status.type === "CANCEL") throw fieldError("statusId", "A new block cannot be cancelled");

    const plan = await tx.ratePlan.findFirst({
      where: { id: input.ratePlanId, propertyId: ctx.propertyId, status: "ACTIVE" },
      select: {
        id: true,
        defaultMarketCodeId: true,
        defaultSourceCodeId: true,
        cancellationPolicyId: true,
        depositPolicyId: true,
      },
    });
    if (!plan) throw fieldError("ratePlanId", "Choose an active rate plan");
    const offered = new Set((await findPlanRoomTypes(tx, plan.id)).map((r) => r.roomTypeId));
    for (const allocation of input.allocations) {
      if (!offered.has(allocation.roomTypeId)) {
        throw fieldError("allocations", "The rate plan is not sold for one of the room types");
      }
    }
    const reservationType = await tx.reservationType.findFirst({
      where: input.reservationTypeId
        ? { id: input.reservationTypeId, propertyId: ctx.propertyId, status: "ACTIVE" }
        : {
            propertyId: ctx.propertyId,
            status: "ACTIVE",
            deductsInventory: true,
            isGuaranteed: true,
          },
      orderBy: { code: "asc" },
      select: { id: true, deductsInventory: true },
    });
    if (!reservationType || !reservationType.deductsInventory) {
      throw fieldError("reservationTypeId", "Choose a reservation type that deducts inventory");
    }
    const marketCodeId = input.marketCodeId ?? plan.defaultMarketCodeId;
    const sourceCodeId = input.sourceCodeId ?? plan.defaultSourceCodeId;
    if (
      !marketCodeId ||
      !(await tx.marketCode.findFirst({ where: { id: marketCodeId, propertyId: ctx.propertyId } }))
    ) {
      throw fieldError("marketCodeId", "Select a market segment");
    }
    if (
      !sourceCodeId ||
      !(await tx.sourceCode.findFirst({ where: { id: sourceCodeId, propertyId: ctx.propertyId } }))
    ) {
      throw fieldError("sourceCodeId", "Select a source");
    }

    const block = await insertBlock(tx, {
      propertyId: ctx.propertyId,
      groupId,
      code: input.code,
      name: input.name,
      statusId: status.id,
      startDate: fromDateOnly(input.startDate),
      endDate: fromDateOnly(input.endDate),
      cutoffDate: input.cutoffDate ? fromDateOnly(input.cutoffDate) : null,
      isElastic: input.isElastic,
      ratePlanId: plan.id,
      marketCodeId,
      sourceCodeId,
      reservationTypeId: reservationType.id,
      cancellationPolicyId: plan.cancellationPolicyId,
      depositPolicyId: plan.depositPolicyId,
      salesOwnerId: ctx.userId,
    });
    const nights = stayNights(input.startDate, input.endDate);
    await tx.blockAllocation.createMany({
      data: input.allocations.flatMap((allocation) =>
        nights.map((date) => ({
          propertyId: ctx.propertyId,
          blockId: block.id,
          roomTypeId: allocation.roomTypeId,
          stayDate: fromDateOnly(date),
          allocated: allocation.rooms,
        })),
      ),
    });

    let short: unknown[] = [];
    if (status.type === "DEDUCT") {
      const demands = demandsOf(
        { startDate: fromDateOnly(input.startDate), endDate: fromDateOnly(input.endDate) },
        input.allocations.map((a) => a.roomTypeId),
      );
      await lockInventoryForRelease(tx, ctx.propertyId, demands);
      const holding = new Map(
        input.allocations.map((a) => [
          a.roomTypeId,
          new Map(
            nights.map((date) => [date, { date, allocated: a.rooms, released: 0, pickedUp: 0 }]),
          ),
        ]),
      );
      short = await assertHouseCovers(
        tx,
        ctx,
        {
          id: block.id,
          startDate: fromDateOnly(input.startDate),
          endDate: fromDateOnly(input.endDate),
        },
        holding,
        input.override,
      );
      await syncInventoryCounters(tx, ctx.propertyId, demands);
    }
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "block.create",
        resourceType: "Block",
        resourceId: block.id,
        risk: short.length > 0 ? "HIGH" : "STANDARD",
        after: {
          groupId,
          code: input.code,
          status: status.code,
          statusType: status.type,
          startDate: input.startDate,
          endDate: input.endDate,
          ratePlanId: plan.id,
          isElastic: input.isElastic,
          allocations: input.allocations,
          ...(short.length > 0 ? { overbooked: short } : {}),
        },
        reason: input.reason ?? null,
        permission: short.length > 0 ? "reservations:override_availability" : "groups:manage",
      },
    );
  });
  return getGroup(ctx, groupId);
}

async function lockForCommand(tx: Tx, ctx: PropertyContext, blockId: string, version: number) {
  const block = await lockBlock(tx, ctx.propertyId, blockId);
  if (!block) throw notFound("Block");
  if (block.version !== version) throw staleVersion("Block");
  const group = await findGroup(tx, ctx.propertyId, block.groupId);
  if (!group) throw notFound("Block");
  return block;
}

/** Sets the rooms held for one room type over a range of the block's nights. */
export async function setAllocation(
  ctx: PropertyContext,
  blockId: string,
  input: AllocationInput,
): Promise<GroupDetail> {
  if (input.override) requirePermission(ctx, "reservations:override_availability");
  const groupId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const block = await lockForCommand(tx, ctx, blockId, input.version);
    if (block.status.type === "CANCEL")
      throw rule("A cancelled block cannot change", "BLOCK_CANCELLED");
    const start = toDateOnly(block.startDate);
    const end = toDateOnly(block.endDate);
    if (input.from < start || input.to >= end) {
      throw fieldError("from", `Choose nights between ${start} and ${addDays(end, -1)}`);
    }
    const offered = new Set(
      (await findPlanRoomTypes(tx, block.ratePlanId!)).map((r) => r.roomTypeId),
    );
    if (!offered.has(input.roomTypeId)) {
      throw fieldError("roomTypeId", "The block's rate plan is not sold for this room type");
    }
    const demands = demandsOf(block, [input.roomTypeId]);
    await lockInventoryForRelease(tx, ctx.propertyId, demands);
    const grid = await findBlockGrid(tx, [block.id]);
    const current = nightsOf(grid, block.id, input.roomTypeId);
    const nights = stayNights(input.from, addDays(input.to, 1));
    const after = new Map(current);
    const before: { date: string; allocated: number }[] = [];
    for (const date of nights) {
      const night = current.get(date) ?? { date, allocated: 0, released: 0, pickedUp: 0 };
      before.push({ date, allocated: night.allocated });
      const next = { ...night, allocated: input.rooms };
      const problem = allocationProblem(next, block.isElastic);
      if (problem) throw rule(`${problem} (${date})`, "ALLOCATION_BELOW_PICKUP", { date });
      after.set(date, next);
    }
    let short: unknown[] = [];
    if (block.status.type === "DEDUCT") {
      short = await assertHouseCovers(
        tx,
        ctx,
        block,
        new Map([[input.roomTypeId, after]]),
        input.override,
      );
    }
    for (const date of nights) {
      await upsertAllocation(tx, {
        propertyId: ctx.propertyId,
        blockId: block.id,
        roomTypeId: input.roomTypeId,
        stayDate: fromDateOnly(date),
        allocated: input.rooms,
      });
    }
    const { count } = await updateBlockVersioned(tx, block.id, block.version, {});
    if (count !== 1) throw staleVersion("Block");
    await syncInventoryCounters(tx, ctx.propertyId, demands);
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "block.allocation",
        resourceType: "Block",
        resourceId: block.id,
        risk: short.length > 0 ? "HIGH" : "STANDARD",
        before: { roomTypeId: input.roomTypeId, nights: before },
        after: {
          roomTypeId: input.roomTypeId,
          from: input.from,
          to: input.to,
          rooms: input.rooms,
          ...(short.length > 0 ? { overbooked: short } : {}),
        },
        reason: input.reason ?? null,
        permission: short.length > 0 ? "reservations:override_availability" : "groups:manage",
      },
    );
    return block.groupId;
  });
  return getGroup(ctx, groupId);
}

export async function changeBlockStatus(
  ctx: PropertyContext,
  blockId: string,
  input: BlockStatusInput,
): Promise<GroupDetail> {
  if (input.override) requirePermission(ctx, "reservations:override_availability");
  const groupId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const block = await lockForCommand(tx, ctx, blockId, input.version);
    const status = await findBlockStatus(tx, ctx.propertyId, input.statusId);
    if (!status) throw fieldError("statusId", "Unknown block status");
    const from = block.status.type as BlockStatusType;
    const to = status.type as BlockStatusType;
    const problem = blockTransitionProblem(from, to, await countActivePickup(tx, block.id));
    if (problem) throw new AppError("INVALID_STATE_TRANSITION", problem, { from, to });
    const grid = await findBlockGrid(tx, [block.id]);
    const roomTypeIds = [...new Set(grid.map((r) => r.room_type_id))];
    const demands = demandsOf(block, roomTypeIds);
    const inventoryChanges = (from === "DEDUCT") !== (to === "DEDUCT");
    let short: unknown[] = [];
    if (inventoryChanges) await lockInventoryForRelease(tx, ctx.propertyId, demands);
    if (to === "DEDUCT" && from !== "DEDUCT") {
      short = await assertHouseCovers(
        tx,
        ctx,
        block,
        new Map(roomTypeIds.map((id) => [id, nightsOf(grid, block.id, id)])),
        input.override,
      );
    }
    const { count } = await updateBlockVersioned(tx, block.id, block.version, {
      statusId: status.id,
    });
    if (count !== 1) throw staleVersion("Block");
    if (inventoryChanges) await syncInventoryCounters(tx, ctx.propertyId, demands);
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "block.status",
        resourceType: "Block",
        resourceId: block.id,
        risk: short.length > 0 ? "HIGH" : "STANDARD",
        before: { status: block.status.code, type: from },
        after: {
          status: status.code,
          type: to,
          ...(short.length > 0 ? { overbooked: short } : {}),
        },
        reason: input.reason ?? null,
        permission: short.length > 0 ? "reservations:override_availability" : "groups:manage",
      },
    );
    return block.groupId;
  });
  return getGroup(ctx, groupId);
}

/**
 * Releases the rooms a block still holds (all room types / nights by
 * default) back to house inventory: `released` grows by what was neither
 * picked up nor already released. Irreversible; idempotent by key.
 */
export async function releaseBlock(
  ctx: PropertyContext,
  blockId: string,
  input: ReleaseInput,
  idempotency: IdempotencyRequest | null,
): Promise<ReleaseResult> {
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const block = await lockForCommand(tx, ctx, blockId, input.version);
      if (block.status.type === "CANCEL")
        throw rule("A cancelled block holds nothing", "BLOCK_CANCELLED");
      const grid = await findBlockGrid(tx, [block.id]);
      const roomTypeIds = [...new Set(grid.map((r) => r.room_type_id))].filter(
        (id) => !input.roomTypeId || id === input.roomTypeId,
      );
      const demands = demandsOf(block, roomTypeIds);
      await lockInventoryForRelease(tx, ctx.propertyId, demands);
      // Re-read after the allocation rows are locked: pickup is final now.
      const locked = await findBlockGrid(tx, [block.id]);
      let released = 0;
      const nights: { roomTypeId: string; date: string; rooms: number }[] = [];
      for (const row of locked) {
        const date = toDateOnly(row.stay_date);
        if (!roomTypeIds.includes(row.room_type_id)) continue;
        if ((input.from && date < input.from) || (input.to && date > input.to)) continue;
        const remaining = remainingRooms({
          allocated: row.allocated,
          released: row.released,
          pickedUp: row.picked,
        });
        if (remaining <= 0) continue;
        await setReleased(tx, {
          blockId: block.id,
          roomTypeId: row.room_type_id,
          stayDate: row.stay_date,
          released: row.released + remaining,
        });
        released += remaining;
        nights.push({ roomTypeId: row.room_type_id, date, rooms: remaining });
      }
      if (released === 0)
        throw rule("The block holds no unpicked rooms in this range", "NOTHING_TO_RELEASE");
      const { count } = await updateBlockVersioned(tx, block.id, block.version, {});
      if (count !== 1) throw staleVersion("Block");
      await syncInventoryCounters(tx, ctx.propertyId, demands);
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate },
        {
          action: "block.release",
          resourceType: "Block",
          resourceId: block.id,
          after: {
            released,
            nights,
            roomTypeId: input.roomTypeId ?? null,
            from: input.from ?? null,
            to: input.to ?? null,
          },
          reason: input.reason,
          permission: "groups:manage",
        },
      );
      return { blockId: block.id, released, version: block.version + 1 } satisfies ReleaseResult;
    });
    return result;
  });
}

/**
 * Picks up rooms from a definite block: one reservation created through the
 * regular booking engine (createReservationInTx) with the block's rate
 * plan, reservation type, codes and policies. The block is held FOR SHARE;
 * inventory comes from the block's allocation under the allocation-row
 * locks (availability.reserveBlockInventory), so two cashiers can never
 * both take the last room. Idempotent by key.
 */
export async function pickup(
  ctx: PropertyContext,
  blockId: string,
  input: PickupInput,
  idempotency: IdempotencyRequest | null,
): Promise<PickupResult> {
  requirePermission(ctx, "groups:read");
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const block = await lockBlockShare(tx, ctx.propertyId, blockId);
      if (!block) throw notFound("Block");
      const group = await findGroup(tx, ctx.propertyId, block.groupId);
      if (!group) throw notFound("Block");
      if (group.status !== "ACTIVE") throw rule("The group is not active", "GROUP_NOT_ACTIVE");
      if (block.status.type !== "DEDUCT" || !block.status.allowsPickup) {
        throw rule("Rooms can be picked up only from a definite block", "BLOCK_NOT_DEFINITE");
      }
      const window = { startDate: toDateOnly(block.startDate), endDate: toDateOnly(block.endDate) };
      if (!stayWithinBlock(window, input)) {
        throw fieldError(
          "arrival",
          `The stay must be within the block (${window.startDate} to ${window.endDate})`,
        );
      }
      if (!block.ratePlanId) throw rule("The block has no rate plan", "BLOCK_WITHOUT_RATE");
      const created = await createReservationInTx(
        tx,
        ctx,
        businessDate,
        {
          arrival: input.arrival,
          departure: input.departure,
          adults: input.adults,
          children: input.children,
          rooms: input.rooms,
          roomTypeId: input.roomTypeId,
          ratePlanId: block.ratePlanId,
          reservationTypeId: block.reservationTypeId,
          guestId: input.guestId,
          marketCodeId: block.marketCodeId,
          sourceCodeId: block.sourceCodeId,
          eta: input.eta,
          specialRequests: input.specialRequests,
          externalReference: undefined,
          waitlist: false,
          override: input.override,
          reason: input.reason,
        },
        {
          block: {
            id: block.id,
            groupId: block.groupId,
            cancellationPolicyId: block.cancellationPolicyId,
            depositPolicyId: block.depositPolicyId,
          },
        },
      );
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate },
        {
          action: "block.pickup",
          resourceType: "Block",
          resourceId: block.id,
          risk: input.override ? "HIGH" : "STANDARD",
          after: {
            reservationId: created.reservationId,
            reservationRoomIds: created.reservationRoomIds,
            roomTypeId: input.roomTypeId,
            arrival: input.arrival,
            departure: input.departure,
            rooms: input.rooms,
          },
          reason: input.reason ?? null,
          permission: input.override ? "reservations:override_availability" : "reservations:create",
        },
      );
      return {
        reservationId: created.reservationId,
        reservationRoomIds: created.reservationRoomIds,
        blockId: block.id,
      } satisfies PickupResult;
    });
    return result;
  });
}

/** Block lookup used by routes that address a block directly. */
export async function requireBlockGroup(ctx: PropertyContext, blockId: string) {
  const block = await findBlock(prisma, ctx.propertyId, blockId);
  if (!block) throw notFound("Block");
  return block.groupId;
}

// --- Night audit (Phase 8) ------------------------------------------------------------------

/**
 * Night audit's automatic cutoff (PMS_WORKFLOWS §18, D21): every definite
 * block whose cutoff date is on or before the closing date releases its
 * unpicked rooms for the nights from `nextDate` on — the same effect as a
 * manual release, recorded with a SYSTEM audit actor. Blocks without a
 * cutoff date keep their rooms until released by hand.
 */
export async function applyCutoffsInTx(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  nextDate: string,
  actor: AuditActor,
): Promise<{ blockId: string; code: string; released: number }[]> {
  const due = await tx.$queryRaw<{ id: string }[]>`
    SELECT b."id"
    FROM "blocks" b
    JOIN "block_statuses" s ON s."id" = b."status_id"
    WHERE b."property_id" = ${ctx.propertyId}::uuid
      AND s."type" = 'DEDUCT'
      AND b."cutoff_date" IS NOT NULL AND b."cutoff_date" <= ${businessDate}::date
      AND b."end_date" > ${nextDate}::date
    ORDER BY b."id"`;
  const results: { blockId: string; code: string; released: number }[] = [];
  for (const { id } of due) {
    const block = await lockBlock(tx, ctx.propertyId, id);
    if (!block) continue;
    const grid = await findBlockGrid(tx, [block.id]);
    const roomTypeIds = [...new Set(grid.map((r) => r.room_type_id))];
    const demands = demandsOf(block, roomTypeIds);
    await lockInventoryForRelease(tx, ctx.propertyId, demands);
    const locked = await findBlockGrid(tx, [block.id]);
    let released = 0;
    const nights: { roomTypeId: string; date: string; rooms: number }[] = [];
    for (const row of locked) {
      const date = toDateOnly(row.stay_date);
      if (date < nextDate) continue;
      const remaining = remainingRooms({
        allocated: row.allocated,
        released: row.released,
        pickedUp: row.picked,
      });
      if (remaining <= 0) continue;
      await setReleased(tx, {
        blockId: block.id,
        roomTypeId: row.room_type_id,
        stayDate: row.stay_date,
        released: row.released + remaining,
      });
      released += remaining;
      nights.push({ roomTypeId: row.room_type_id, date, rooms: remaining });
    }
    if (released === 0) continue;
    const { count } = await updateBlockVersioned(tx, block.id, block.version, {});
    if (count !== 1) throw staleVersion("Block");
    await syncInventoryCounters(tx, ctx.propertyId, demands);
    await recordAudit(
      tx,
      { ...actor, businessDate },
      {
        action: "block.cutoff",
        resourceType: "Block",
        resourceId: block.id,
        after: { released, nights, cutoffDate: toDateOnly(block.cutoffDate!), from: nextDate },
        permission: "nightaudit:run",
      },
    );
    results.push({ blockId: block.id, code: block.code, released });
  }
  return results;
}
