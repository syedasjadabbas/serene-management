import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { AppError, notFound, staleVersion } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit.service";
import { reconcileInventoryInTx } from "@/modules/availability/availability.service";
import { fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import {
  countSetup,
  existingRoomNumbers,
  findSetupFloors,
  findSetupRooms,
  findSetupRoomTypes,
  findSetupTaxes,
  findTaxableCodes,
  lockSetupRoom,
  nextTaxPostingCode,
  roomCommitments,
  roomTypeBookings,
} from "./setup.repository";
import type {
  CreateFloorInput,
  CreateRoomsInput,
  CreateRoomTypeInput,
  CreateTaxInput,
  UpdateFloorInput,
  UpdateRoomInput,
  UpdateRoomTypeInput,
  UpdateTaxInput,
} from "./setup.schema";
import type { PropertySetupView } from "./setup.types";

/**
 * Property setup: room types, floors, rooms and taxes (docs/IMPLEMENTATION_ROADMAP.md
 * Phase 2 configuration). Changes are HIGH-risk audited (`settings:manage`).
 * Room changes recount the cached inventory of every future night in the same
 * transaction (the night audit's reconciliation, D12), so availability and
 * selling always reflect the rooms that exist.
 */

function fieldError(field: string, message: string, reason?: string) {
  return new AppError("VALIDATION_FAILED", message, {
    fields: { [field]: [message] },
    ...(reason ? { reason } : {}),
  });
}

function rule(message: string, reason: string) {
  return new AppError("BUSINESS_RULE_VIOLATION", message, { reason });
}

/** From which night bookings and counters matter: the business date (or every date before go-live). */
const fromDate = (ctx: PropertyContext) => ctx.businessDate ?? "1900-01-01";

async function audit(
  tx: Tx,
  ctx: PropertyContext,
  entry: {
    action: string;
    resourceType: string;
    resourceId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    reason: string;
    reasonCodeId?: string;
  },
) {
  await recordAudit(
    tx,
    { ...auditActor(ctx), propertyId: ctx.propertyId },
    {
      ...entry,
      risk: "HIGH",
      reasonCodeId: entry.reasonCodeId ?? null,
      permission: "settings:manage",
    },
  );
}

// --- Read -------------------------------------------------------------------------------

export async function getPropertySetup(ctx: PropertyContext): Promise<PropertySetupView> {
  const [roomTypes, floors, rooms, taxes, codes, counts] = await Promise.all([
    findSetupRoomTypes(prisma, ctx.propertyId),
    findSetupFloors(prisma, ctx.propertyId),
    findSetupRooms(prisma, ctx.propertyId),
    findSetupTaxes(prisma, ctx.propertyId),
    findTaxableCodes(prisma, ctx.propertyId),
    countSetup(prisma, ctx.propertyId),
  ]);
  return {
    roomTypes: roomTypes.map(({ _count, ...t }) => ({ ...t, activeRooms: _count.rooms })),
    floors: floors.map(({ _count, ...f }) => ({ ...f, activeRooms: _count.rooms })),
    rooms: rooms.map((r) => ({
      id: r.id,
      number: r.number,
      roomTypeId: r.roomTypeId,
      roomTypeCode: r.roomType.code,
      floorId: r.floorId,
      floorName: r.floor?.name ?? null,
      description: r.description,
      isSmoking: r.isSmoking,
      isAccessible: r.isAccessible,
      status: r.status,
      housekeepingStatus: r.housekeepingStatus,
      frontOfficeStatus: r.frontOfficeStatus,
      version: r.version,
    })),
    taxes: taxes.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      calculation: t.calculation,
      basis: t.basis,
      rate: t.rate.toFixed(4),
      effectiveFrom: toDateOnly(t.effectiveFrom),
      effectiveTo: t.effectiveTo ? toDateOnly(t.effectiveTo) : null,
      status: t.status,
      appliesTo: t.appliesTo.map((a) => a.transactionCode),
    })),
    revenueCodes: codes.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      groupName: c.group.name,
    })),
    readiness: { ...counts, live: ctx.businessDate !== null, businessDate: ctx.businessDate },
  };
}

// --- Room types -------------------------------------------------------------------------

export async function createRoomType(ctx: PropertyContext, input: CreateRoomTypeInput) {
  await runInTransaction(async (tx) => {
    const taken = await tx.roomType.findFirst({
      where: { propertyId: ctx.propertyId, code: input.code },
      select: { id: true },
    });
    if (taken) throw fieldError("code", `Room type ${input.code} already exists`, "CODE_TAKEN");
    const row = await tx.roomType.create({
      data: {
        propertyId: ctx.propertyId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        maxOccupancy: input.maxOccupancy,
        maxAdults: input.maxAdults,
        maxChildren: input.maxChildren,
        defaultOccupancy: input.defaultOccupancy,
        sortOrder: input.sortOrder ?? 0,
      },
      select: { id: true },
    });
    await audit(tx, ctx, {
      action: "setup.room_type_create",
      resourceType: "RoomType",
      resourceId: row.id,
      after: { code: input.code, name: input.name, maxOccupancy: input.maxOccupancy },
      reason: input.reason,
      reasonCodeId: input.reasonCodeId,
    });
  });
  return getPropertySetup(ctx);
}

export async function updateRoomType(
  ctx: PropertyContext,
  roomTypeId: string,
  input: UpdateRoomTypeInput,
) {
  await runInTransaction(async (tx) => {
    const before = await tx.roomType.findFirst({
      where: { propertyId: ctx.propertyId, id: roomTypeId, isPseudo: false },
    });
    if (!before) throw notFound("Room type");
    if (before.status === "ACTIVE" && input.status === "INACTIVE") {
      const rooms = await tx.room.count({
        where: { propertyId: ctx.propertyId, roomTypeId, status: "ACTIVE" },
      });
      if (rooms > 0) {
        throw rule(
          `Move or retire its ${rooms} active room${rooms === 1 ? "" : "s"} before retiring this room type`,
          "ROOM_TYPE_HAS_ROOMS",
        );
      }
      const bookings = await roomTypeBookings(tx, ctx.propertyId, roomTypeId, fromDate(ctx));
      if (bookings > 0) {
        throw rule(
          `${bookings} current or upcoming booking${bookings === 1 ? " uses" : "s use"} this room type`,
          "ROOM_TYPE_IN_USE",
        );
      }
    }
    await tx.roomType.update({
      where: { id: roomTypeId },
      data: {
        name: input.name,
        description: input.description ?? null,
        maxOccupancy: input.maxOccupancy,
        maxAdults: input.maxAdults,
        maxChildren: input.maxChildren,
        defaultOccupancy: input.defaultOccupancy,
        sortOrder: input.sortOrder ?? before.sortOrder,
        status: input.status,
      },
    });
    await audit(tx, ctx, {
      action: "setup.room_type_update",
      resourceType: "RoomType",
      resourceId: roomTypeId,
      before: {
        name: before.name,
        maxOccupancy: before.maxOccupancy,
        maxAdults: before.maxAdults,
        maxChildren: before.maxChildren,
        defaultOccupancy: before.defaultOccupancy,
        status: before.status,
      },
      after: {
        name: input.name,
        maxOccupancy: input.maxOccupancy,
        maxAdults: input.maxAdults,
        maxChildren: input.maxChildren,
        defaultOccupancy: input.defaultOccupancy,
        status: input.status,
      },
      reason: input.reason,
      reasonCodeId: input.reasonCodeId,
    });
  });
  return getPropertySetup(ctx);
}

// --- Floors -----------------------------------------------------------------------------

export async function createFloor(ctx: PropertyContext, input: CreateFloorInput) {
  await runInTransaction(async (tx) => {
    const taken = await tx.floor.findFirst({
      where: { propertyId: ctx.propertyId, code: input.code },
      select: { id: true },
    });
    if (taken) throw fieldError("code", `Floor ${input.code} already exists`, "CODE_TAKEN");
    const row = await tx.floor.create({
      data: {
        propertyId: ctx.propertyId,
        code: input.code,
        name: input.name,
        level: input.level,
        sortOrder: input.sortOrder ?? input.level,
      },
      select: { id: true },
    });
    await audit(tx, ctx, {
      action: "setup.floor_create",
      resourceType: "Floor",
      resourceId: row.id,
      after: { code: input.code, name: input.name, level: input.level },
      reason: input.reason,
      reasonCodeId: input.reasonCodeId,
    });
  });
  return getPropertySetup(ctx);
}

export async function updateFloor(ctx: PropertyContext, floorId: string, input: UpdateFloorInput) {
  await runInTransaction(async (tx) => {
    const before = await tx.floor.findFirst({ where: { propertyId: ctx.propertyId, id: floorId } });
    if (!before) throw notFound("Floor");
    if (before.status === "ACTIVE" && input.status === "INACTIVE") {
      const rooms = await tx.room.count({
        where: { propertyId: ctx.propertyId, floorId, status: "ACTIVE" },
      });
      if (rooms > 0) {
        throw rule(
          `Move its ${rooms} active room${rooms === 1 ? "" : "s"} to another floor first`,
          "FLOOR_HAS_ROOMS",
        );
      }
    }
    await tx.floor.update({
      where: { id: floorId },
      data: {
        name: input.name,
        level: input.level,
        sortOrder: input.sortOrder ?? before.sortOrder,
        status: input.status,
      },
    });
    await audit(tx, ctx, {
      action: "setup.floor_update",
      resourceType: "Floor",
      resourceId: floorId,
      before: { name: before.name, level: before.level, status: before.status },
      after: { name: input.name, level: input.level, status: input.status },
      reason: input.reason,
      reasonCodeId: input.reasonCodeId,
    });
  });
  return getPropertySetup(ctx);
}

// --- Rooms ------------------------------------------------------------------------------

async function requireActiveRoomType(tx: Tx, ctx: PropertyContext, roomTypeId: string) {
  const type = await tx.roomType.findFirst({
    where: { propertyId: ctx.propertyId, id: roomTypeId, isPseudo: false },
    select: { id: true, code: true, status: true },
  });
  if (!type) throw fieldError("roomTypeId", "Choose a room type of this property");
  if (type.status !== "ACTIVE") throw fieldError("roomTypeId", `Room type ${type.code} is retired`);
  return type;
}

async function requireActiveFloor(tx: Tx, ctx: PropertyContext, floorId: string | null) {
  if (!floorId) return null;
  const floor = await tx.floor.findFirst({
    where: { propertyId: ctx.propertyId, id: floorId },
    select: { id: true, status: true, name: true },
  });
  if (!floor) throw fieldError("floorId", "Choose a floor of this property");
  if (floor.status !== "ACTIVE") throw fieldError("floorId", `${floor.name} is retired`);
  return floor;
}

/** Adds rooms (one or a numbered range) and recounts the future inventory of their type. */
export async function createRooms(ctx: PropertyContext, input: CreateRoomsInput) {
  await runInTransaction(async (tx) => {
    const type = await requireActiveRoomType(tx, ctx, input.roomTypeId);
    await requireActiveFloor(tx, ctx, input.floorId);
    const taken = await existingRoomNumbers(tx, ctx.propertyId, input.numbers);
    if (taken.length > 0) {
      throw fieldError(
        "numbers",
        `Room${taken.length === 1 ? "" : "s"} ${taken.slice(0, 10).join(", ")} already exist${taken.length === 1 ? "s" : ""}`,
        "ROOM_NUMBER_TAKEN",
      );
    }
    const last = await tx.room.aggregate({
      where: { propertyId: ctx.propertyId },
      _max: { sortOrder: true },
    });
    let sort = (last._max.sortOrder ?? 0) + 1;
    const data: Prisma.RoomCreateManyInput[] = input.numbers.map((number) => ({
      propertyId: ctx.propertyId,
      roomTypeId: type.id,
      floorId: input.floorId,
      number,
      description: input.description ?? null,
      isSmoking: input.isSmoking,
      isAccessible: input.isAccessible,
      housekeepingStatus: input.housekeepingStatus,
      sortOrder: sort++,
    }));
    await tx.room.createMany({ data });
    const created = await tx.room.findMany({
      where: { propertyId: ctx.propertyId, number: { in: input.numbers } },
      select: { id: true, number: true },
    });
    const repairs = await reconcileInventoryInTx(tx, ctx.propertyId, fromDate(ctx));
    await audit(tx, ctx, {
      action: "setup.rooms_create",
      resourceType: "RoomType",
      resourceId: type.id,
      after: {
        roomType: type.code,
        numbers: created.map((r) => r.number),
        housekeepingStatus: input.housekeepingStatus,
        inventoryNightsRecounted: repairs.length,
      },
      reason: input.reason,
      reasonCodeId: input.reasonCodeId,
    });
  });
  return getPropertySetup(ctx);
}

/**
 * Edits one room. Changing its type or retiring it is refused while a guest is
 * in it or a live reservation is assigned to it; either way the future
 * inventory of the affected types is recounted.
 */
export async function updateRoom(ctx: PropertyContext, roomId: string, input: UpdateRoomInput) {
  await runInTransaction(async (tx) => {
    const locked = await lockSetupRoom(tx, ctx.propertyId, roomId);
    if (!locked) throw notFound("Room");
    if (locked.version !== input.version) throw staleVersion("Room");
    const before = await tx.room.findUniqueOrThrow({
      where: { id: roomId },
      select: {
        number: true,
        roomTypeId: true,
        floorId: true,
        status: true,
        isSmoking: true,
        isAccessible: true,
        description: true,
        roomType: { select: { code: true } },
      },
    });
    const typeChanged = input.roomTypeId !== before.roomTypeId;
    const retiring = before.status === "ACTIVE" && input.status === "INACTIVE";
    const reactivating = before.status === "INACTIVE" && input.status === "ACTIVE";
    if (typeChanged || retiring) {
      const { inHouse, assigned } = await roomCommitments(
        tx,
        ctx.propertyId,
        roomId,
        fromDate(ctx),
      );
      if (inHouse > 0) {
        throw rule(
          `A guest is in room ${before.number}; check them out or move them first`,
          "ROOM_OCCUPIED",
        );
      }
      if (assigned > 0) {
        throw rule(
          `${assigned} current or upcoming reservation${assigned === 1 ? " is" : "s are"} assigned to room ${before.number}; reassign ${assigned === 1 ? "it" : "them"} first`,
          "ROOM_ASSIGNED",
        );
      }
    }
    if (typeChanged || reactivating || input.status === "ACTIVE") {
      await requireActiveRoomType(tx, ctx, input.roomTypeId);
    }
    if (input.floorId !== before.floorId) await requireActiveFloor(tx, ctx, input.floorId);
    if (input.number !== before.number) {
      const taken = await existingRoomNumbers(tx, ctx.propertyId, [input.number]);
      if (taken.length > 0) {
        throw fieldError("number", `Room ${input.number} already exists`, "ROOM_NUMBER_TAKEN");
      }
    }
    await tx.room.update({
      where: { id: roomId },
      data: {
        number: input.number,
        roomTypeId: input.roomTypeId,
        floorId: input.floorId,
        description: input.description ?? null,
        isSmoking: input.isSmoking,
        isAccessible: input.isAccessible,
        status: input.status,
        version: { increment: 1 },
      },
    });
    const affectsInventory = typeChanged || retiring || reactivating;
    const repairs = affectsInventory
      ? await reconcileInventoryInTx(tx, ctx.propertyId, fromDate(ctx))
      : [];
    await audit(tx, ctx, {
      action: "setup.room_update",
      resourceType: "Room",
      resourceId: roomId,
      before: {
        number: before.number,
        roomType: before.roomType.code,
        floorId: before.floorId,
        status: before.status,
        isSmoking: before.isSmoking,
        isAccessible: before.isAccessible,
      },
      after: {
        number: input.number,
        roomTypeId: input.roomTypeId,
        floorId: input.floorId,
        status: input.status,
        isSmoking: input.isSmoking,
        isAccessible: input.isAccessible,
        ...(affectsInventory ? { inventoryNightsRecounted: repairs.length } : {}),
      },
      reason: input.reason,
      reasonCodeId: input.reasonCodeId,
    });
  });
  return getPropertySetup(ctx);
}

// --- Taxes ------------------------------------------------------------------------------

async function requireTaxableCodes(tx: Tx, ctx: PropertyContext, ids: string[]) {
  if (ids.length === 0) return [];
  const codes = await findTaxableCodes(tx, ctx.propertyId);
  const allowed = new Map(codes.map((c) => [c.id, c]));
  const unknown = ids.filter((id) => !allowed.has(id));
  if (unknown.length > 0) {
    throw fieldError("appliesTo", "A tax can be added only to this property's revenue codes");
  }
  return [...new Set(ids)];
}

/**
 * Creates a tax rule with its own posting code in the "Taxes & service
 * charges" group, applied to the chosen revenue codes from `effectiveFrom`.
 */
export async function createTax(ctx: PropertyContext, input: CreateTaxInput) {
  await runInTransaction(async (tx) => {
    const taken = await tx.taxRule.findFirst({
      where: { propertyId: ctx.propertyId, code: input.code },
      select: { id: true },
    });
    if (taken) throw fieldError("code", `Tax ${input.code} already exists`, "CODE_TAKEN");
    const appliesTo = await requireTaxableCodes(tx, ctx, input.appliesTo);
    const group = await tx.transactionCodeGroup.findFirst({
      where: { propertyId: ctx.propertyId, code: "TAX" },
      select: { id: true },
    });
    if (!group) {
      throw rule(
        "This property has no tax code group; copy the setup from another property first",
        "TAX_GROUP_MISSING",
      );
    }
    const postingCode = await tx.transactionCode.create({
      data: {
        propertyId: ctx.propertyId,
        groupId: group.id,
        code: await nextTaxPostingCode(tx, ctx.propertyId),
        name: input.name,
        bucket: "TAX",
        isManualPostAllowed: false,
      },
      select: { id: true, code: true },
    });
    const tax = await tx.taxRule.create({
      data: {
        propertyId: ctx.propertyId,
        code: input.code,
        name: input.name,
        calculation: input.calculation,
        basis: input.basis,
        rate: input.rate,
        transactionCodeId: postingCode.id,
        effectiveFrom: fromDateOnly(input.effectiveFrom),
        effectiveTo: input.effectiveTo ? fromDateOnly(input.effectiveTo) : null,
      },
      select: { id: true },
    });
    if (appliesTo.length > 0) {
      await tx.transactionCodeTax.createMany({
        data: appliesTo.map((transactionCodeId) => ({
          propertyId: ctx.propertyId,
          transactionCodeId,
          taxRuleId: tax.id,
          sequence: 1,
        })),
      });
    }
    await audit(tx, ctx, {
      action: "setup.tax_create",
      resourceType: "TaxRule",
      resourceId: tax.id,
      after: {
        code: input.code,
        name: input.name,
        calculation: input.calculation,
        basis: input.basis,
        rate: input.rate,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        postingCode: postingCode.code,
        appliesTo,
      },
      reason: input.reason,
      reasonCodeId: input.reasonCodeId,
    });
  });
  return getPropertySetup(ctx);
}

/**
 * Edits a tax rule. Charges already posted keep the tax they were posted with
 * (ledger rows are immutable); the change applies to later postings and to
 * estimates. To change a rate from a date, end this rule and add a new one.
 */
export async function updateTax(ctx: PropertyContext, taxRuleId: string, input: UpdateTaxInput) {
  await runInTransaction(async (tx) => {
    const before = await tx.taxRule.findFirst({
      where: { propertyId: ctx.propertyId, id: taxRuleId },
      include: { appliesTo: { select: { transactionCodeId: true } } },
    });
    if (!before) throw notFound("Tax");
    const appliesTo = await requireTaxableCodes(tx, ctx, input.appliesTo);
    await tx.taxRule.update({
      where: { id: taxRuleId },
      data: {
        name: input.name,
        calculation: input.calculation,
        basis: input.basis,
        rate: input.rate,
        effectiveFrom: fromDateOnly(input.effectiveFrom),
        effectiveTo: input.effectiveTo ? fromDateOnly(input.effectiveTo) : null,
        status: input.status,
      },
    });
    const current = new Set(before.appliesTo.map((a) => a.transactionCodeId));
    const next = new Set(appliesTo);
    const removed = [...current].filter((id) => !next.has(id));
    const added = appliesTo.filter((id) => !current.has(id));
    if (removed.length > 0) {
      await tx.transactionCodeTax.deleteMany({
        where: { propertyId: ctx.propertyId, taxRuleId, transactionCodeId: { in: removed } },
      });
    }
    if (added.length > 0) {
      await tx.transactionCodeTax.createMany({
        data: added.map((transactionCodeId) => ({
          propertyId: ctx.propertyId,
          transactionCodeId,
          taxRuleId,
          sequence: 1,
        })),
      });
    }
    await audit(tx, ctx, {
      action: "setup.tax_update",
      resourceType: "TaxRule",
      resourceId: taxRuleId,
      before: {
        name: before.name,
        calculation: before.calculation,
        basis: before.basis,
        rate: before.rate.toFixed(4),
        effectiveFrom: toDateOnly(before.effectiveFrom),
        effectiveTo: before.effectiveTo ? toDateOnly(before.effectiveTo) : null,
        status: before.status,
        appliesTo: [...current],
      },
      after: {
        name: input.name,
        calculation: input.calculation,
        basis: input.basis,
        rate: input.rate,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        status: input.status,
        appliesTo,
      },
      reason: input.reason,
      reasonCodeId: input.reasonCodeId,
    });
  });
  return getPropertySetup(ctx);
}
