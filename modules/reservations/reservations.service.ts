import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { AppError, forbidden, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasPermission } from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { formatMoney, parseMoney, sum } from "@/lib/utils/money";
import { recordAudit } from "@/modules/audit/audit.service";
import type { RestrictionViolation } from "@/modules/availability/availability.policy";
import {
  type InventoryDemand,
  loadRestrictions,
  lockInventoryForRelease,
  reserveBlockInventory,
  reserveInventory,
  syncInventoryCounters,
} from "@/modules/availability/availability.service";
import {
  addDays,
  fromDateOnly,
  localMidnightUtc,
  toDateOnly,
} from "@/modules/business-date/business-date.policy";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { normalizeName } from "@/modules/guests/guests.policy";
import { requireGuest } from "@/modules/guests/guests.service";
import { allocateNumber } from "@/modules/properties/properties.service";
import {
  type StayRequest,
  currencyMinorUnits,
  loadRates,
  lockRatePlanForPricing,
  priceForBooking,
} from "@/modules/rates/rates.service";
import { requireSellablePackage } from "@/modules/rates/packages.service";
import type { ReservationPackageInput } from "@/modules/rates/rates.schema";
import type { CursorPageMeta } from "@/types/api";
import {
  type ReservationAction,
  type ReservationStatus,
  bookingState,
  consumesInventory,
  displayConfirmation,
  nightCount,
  occupancyProblems,
  stayNights,
  transitionProblem,
} from "./reservations.policy";
import {
  type LockedReservationRoom,
  closeActiveAssignments,
  lockRoomRow,
  countActiveAssignments,
  countRoomOutOfOrder,
  deleteNights,
  deleteNightsFrom,
  findAuditHistory,
  findAvailableRooms,
  findBookingOptions,
  findChannel,
  findMarketCode,
  findNightsForPosting,
  findReservationPackage,
  deleteReservationPackage,
  insertReservationPackage,
  findRatePlanDefaults,
  findReasonCode,
  findReservationDetail,
  findReservationRoomsPage,
  findReservationType,
  findRoom,
  findRoomType,
  findSourceCode,
  findUserNames,
  insertAssignment,
  insertNights,
  insertNote,
  insertReservation,
  insertReservationRoom,
  lockReservationRoom,
  releaseActiveAssignments,
  replacePrimaryGuest,
  setNightPosted,
  sumNightAmounts,
  updateReservationRoomVersioned,
} from "./reservations.repository";
import type {
  AssignRoomInput,
  AvailableRoomsQuery,
  CancelReservationInput,
  ConfirmReservationInput,
  CreateReservationInput,
  ListReservationsQuery,
  NoShowReservationInput,
  ReinstateReservationInput,
  UpdateReservationRoomInput,
} from "./reservations.schema";
import type {
  AvailableRoomView,
  BookingOptions,
  ReservationDetail,
  ReservationListItem,
  ReservationRoomDetail,
} from "./reservations.types";

/**
 * Reservation engine (docs/PMS_WORKFLOWS.md §2, §3, §4, §14–§16).
 *
 * Every command runs in one transaction, in the documented lock order:
 * business date (FOR SHARE) → reservation room (FOR UPDATE) → inventory
 * cells (FOR UPDATE, sorted) → property sequence. Inventory is re-counted
 * after the locks are held, so two concurrent bookings of the last room
 * cannot both succeed; the room-level exclusion constraint independently
 * prevents double-assigning a physical room.
 */

// --- Helpers ------------------------------------------------------------------------

function requirePermission(ctx: PropertyContext, permission: Permission) {
  if (!hasPermission(ctx.access, ctx.propertyId, permission)) throw forbidden(permission);
}

function assertTransition(
  action: ReservationAction,
  room: LockedReservationRoom,
  businessDate: string,
) {
  const problem = transitionProblem(action, stateOf(room), businessDate);
  if (problem) {
    throw new AppError("INVALID_STATE_TRANSITION", problem, {
      action,
      status: room.status,
      bookingState: bookingState(room.status, room.reservationType.deductsInventory),
    });
  }
}

function stateOf(room: LockedReservationRoom) {
  return {
    status: room.status as ReservationStatus,
    deductsInventory: room.reservationType.deductsInventory,
    arrival: toDateOnly(room.arrivalDate),
    departure: toDateOnly(room.departureDate),
  };
}

function demandOf(roomTypeId: string, arrival: string, departure: string): InventoryDemand {
  return { roomTypeId, arrival, departure, rooms: 1 };
}

async function lockRoomOrThrow(
  tx: Tx,
  ctx: PropertyContext,
  reservationRoomId: string,
  version: number,
) {
  const room = await lockReservationRoom(tx, ctx.propertyId, reservationRoomId);
  if (!room) throw notFound("Reservation");
  if (room.version !== version) throw staleVersion("Reservation");
  return room;
}

async function saveVersioned(
  tx: Tx,
  room: LockedReservationRoom,
  data: Prisma.ReservationRoomUncheckedUpdateManyInput,
) {
  const { count } = await updateReservationRoomVersioned(tx, room.id, room.version, data);
  if (count !== 1) throw staleVersion("Reservation");
}

function assertArrivalNotPast(arrival: string, businessDate: string) {
  if (arrival < businessDate) {
    throw new AppError("VALIDATION_FAILED", "Arrival cannot be before the hotel business date", {
      fields: { arrival: [`Arrival must be on or after ${businessDate}`] },
    });
  }
}

function assertOccupancy(
  roomType: { maxOccupancy: number; maxAdults: number; maxChildren: number },
  adults: number,
  children: number,
) {
  const problems = occupancyProblems(roomType, adults, children);
  if (problems.length > 0) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "The party does not fit the selected room type", {
      reason: "OCCUPANCY",
      problems,
    });
  }
}

async function requireRoomType(tx: Tx, propertyId: string, id: string) {
  const roomType = await findRoomType(tx, propertyId, id);
  if (!roomType) throw notFound("Room type");
  return roomType;
}

/**
 * Validates a specific room for a stay: same property, active, right type,
 * not out of order. The room row is locked FOR UPDATE first, so the check
 * and the assignment that follows serialize with out-of-order placement
 * (which locks the same row before checking assignments). Lock order: call
 * after any inventory and sequence locks of the command.
 */
async function requireAssignableRoom(
  tx: Tx,
  propertyId: string,
  roomId: string,
  roomTypeId: string,
  arrival: string,
  departure: string,
) {
  await lockRoomRow(tx, propertyId, roomId);
  const room = await findRoom(tx, propertyId, roomId);
  if (!room) throw notFound("Room");
  if (room.roomTypeId !== roomTypeId) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The room does not belong to the reserved room type",
      {
        reason: "ROOM_TYPE_MISMATCH",
      },
    );
  }
  if (
    (await countRoomOutOfOrder(tx, room.id, fromDateOnly(arrival), fromDateOnly(departure))) > 0
  ) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      `Room ${room.number} is out of order during the stay`,
      {
        reason: "ROOM_OUT_OF_ORDER",
      },
    );
  }
  return room;
}

/** Prices a stay and returns restriction violations (type-level + rate-plan-level). */
async function priceStay(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  stay: {
    arrival: string;
    departure: string;
    adults: number;
    children: number;
    roomTypeId: string;
    ratePlanId: string;
  },
  options: { allowGroupRates?: boolean } = {},
) {
  const request: StayRequest = {
    propertyId: ctx.propertyId,
    businessDate,
    arrival: stay.arrival,
    departure: stay.departure,
    nights: stayNights(stay.arrival, stay.departure),
    adults: stay.adults,
    children: stay.children,
  };
  // The plan and its parents are read under FOR SHARE, so a concurrent rate
  // change either commits before this price is taken or waits for it.
  await lockRatePlanForPricing(tx, ctx.propertyId, stay.ratePlanId);
  const rates = await loadRates(tx, request, ctx.currencyCode);
  const restrictions = await loadRestrictions(tx, ctx.propertyId, stay.arrival, stay.departure);
  const { quote, nightly } = priceForBooking(
    rates,
    request,
    stay.roomTypeId,
    stay.ratePlanId,
    restrictions,
    options,
  );
  // The quote already evaluates every applicable restriction (house, room
  // type, rate plan) with the same evaluator the availability search uses.
  const violations: RestrictionViolation[] = quote.restrictions;
  return { nightly, violations, total: quote.total };
}

function assertNoRestrictions(violations: RestrictionViolation[], override: boolean) {
  if (violations.length > 0 && !override) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "The stay violates a sales restriction", {
      reason: "RESTRICTED",
      restrictions: violations,
    });
  }
}

function nightRows(
  propertyId: string,
  reservationRoomId: string,
  stay: { roomTypeId: string; ratePlanId: string; adults: number; children: number },
  currencyCode: string,
  nightly: { date: string; amount: bigint }[],
): Prisma.ReservationRoomNightCreateManyInput[] {
  return nightly.map((night) => ({
    propertyId,
    reservationRoomId,
    stayDate: fromDateOnly(night.date),
    roomTypeId: stay.roomTypeId,
    ratePlanId: stay.ratePlanId,
    rateAmount: formatMoney(night.amount),
    currencyCode,
    adults: stay.adults,
    children: stay.children,
  }));
}

// --- Commands -------------------------------------------------------------------------

export async function createReservation(
  ctx: PropertyContext,
  input: CreateReservationInput,
): Promise<ReservationDetail> {
  const reservationId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    return (await createReservationInTx(tx, ctx, businessDate, input)).reservationId;
  });
  return getReservation(ctx, reservationId);
}

/**
 * The booking command inside the caller's transaction (the caller holds the
 * business-date lock). Used directly by walk-ins, which check in within the
 * same transaction.
 */
export async function createReservationInTx(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  input: CreateReservationInput,
  options: {
    walkIn?: boolean;
    /**
     * Group-block pickup (validated by modules/groups, which holds the block
     * FOR SHARE): inventory comes from the block's allocation and the
     * reservation is linked to the group and block.
     */
    block?: {
      id: string;
      groupId: string;
      cancellationPolicyId: string | null;
      depositPolicyId: string | null;
    };
  } = {},
): Promise<{ reservationId: string; reservationRoomIds: string[] }> {
  if (input.override) requirePermission(ctx, "reservations:override_availability");
  if (input.waitlist) requirePermission(ctx, "reservations:waitlist");
  if (input.roomId) requirePermission(ctx, "rooms:assign");
  assertArrivalNotPast(input.arrival, businessDate);

  const roomType = await requireRoomType(tx, ctx.propertyId, input.roomTypeId);
  assertOccupancy(roomType, input.adults, input.children);
  const ratePlan = await findRatePlanDefaults(tx, ctx.propertyId, input.ratePlanId);
  if (!ratePlan) throw notFound("Rate plan");
  const reservationType = await findReservationType(tx, ctx.propertyId, input.reservationTypeId);
  if (!reservationType) throw notFound("Reservation type");

  const marketCodeId = input.marketCodeId ?? ratePlan.defaultMarketCodeId;
  const sourceCodeId = input.sourceCodeId ?? ratePlan.defaultSourceCodeId;
  if (!marketCodeId || !(await findMarketCode(tx, ctx.propertyId, marketCodeId))) {
    throw new AppError("VALIDATION_FAILED", "Select a market segment", {
      fields: { marketCodeId: ["Required"] },
    });
  }
  if (!sourceCodeId || !(await findSourceCode(tx, ctx.propertyId, sourceCodeId))) {
    throw new AppError("VALIDATION_FAILED", "Select a source", {
      fields: { sourceCodeId: ["Required"] },
    });
  }
  if (input.channelId && !(await findChannel(tx, ctx.propertyId, input.channelId)))
    throw notFound("Channel");

  const guest = await requireGuest(tx, ctx.organizationId, input.guestId);
  if (guest.isRestricted) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "This guest profile is restricted from booking", {
      reason: "GUEST_RESTRICTED",
    });
  }

  const stay = {
    arrival: input.arrival,
    departure: input.departure,
    adults: input.adults,
    children: input.children,
    roomTypeId: roomType.id,
    ratePlanId: ratePlan.id,
  };
  const priced = await priceStay(tx, ctx, businessDate, stay, {
    allowGroupRates: options.block !== undefined,
  });
  assertNoRestrictions(priced.violations, input.override);

  const status: ReservationStatus = input.waitlist ? "WAITLISTED" : "RESERVED";
  const deducts = consumesInventory(status, reservationType.deductsInventory);
  const demand: InventoryDemand = {
    ...demandOf(roomType.id, input.arrival, input.departure),
    rooms: input.rooms,
  };
  if (deducts && options.block) {
    await reserveBlockInventory(tx, ctx.propertyId, options.block.id, demand, {
      allowOverbooking: input.override,
    });
  } else if (deducts) {
    await reserveInventory(tx, ctx.propertyId, [demand], { allowOverbooking: input.override });
  }

  const confirmationNumber = await allocateNumber(tx, ctx.propertyId, "confirmation");
  // The specific room is locked and checked after inventory and sequence (lock order).
  const room = input.roomId
    ? await requireAssignableRoom(
        tx,
        ctx.propertyId,
        input.roomId,
        roomType.id,
        input.arrival,
        input.departure,
      )
    : null;

  const reservation = await insertReservation(tx, {
    propertyId: ctx.propertyId,
    confirmationNumber,
    bookerGuestId: guest.id,
    channelId: input.channelId ?? null,
    sourceCodeId,
    marketCodeId,
    externalReference: input.externalReference ?? null,
    bookedById: ctx.userId,
    groupId: options.block?.groupId ?? null,
    blockId: options.block?.id ?? null,
  });

  const roomIds: string[] = [];
  for (let line = 1; line <= input.rooms; line++) {
    const created = await insertReservationRoom(tx, {
      propertyId: ctx.propertyId,
      reservationId: reservation.id,
      lineNumber: line,
      status,
      primaryGuestId: guest.id,
      arrivalDate: fromDateOnly(input.arrival),
      departureDate: fromDateOnly(input.departure),
      eta: input.eta ?? null,
      adults: input.adults,
      children: input.children,
      roomTypeId: roomType.id,
      rateRoomTypeId: roomType.id,
      roomId: line === 1 && room ? room.id : null,
      isWalkIn: options.walkIn ?? false,
      ratePlanId: ratePlan.id,
      currencyCode: ctx.currencyCode,
      reservationTypeId: reservationType.id,
      marketCodeId,
      sourceCodeId,
      cancellationPolicyId: options.block?.cancellationPolicyId ?? ratePlan.cancellationPolicyId,
      depositPolicyId: options.block?.depositPolicyId ?? ratePlan.depositPolicyId,
      blockId: options.block?.id ?? null,
      guests: { create: [{ guestId: guest.id, isPrimary: true, sequence: 1 }] },
    });
    roomIds.push(created.id);
    await insertNights(
      tx,
      nightRows(ctx.propertyId, created.id, stay, ctx.currencyCode, priced.nightly),
    );
  }

  if (room) {
    const firstRoomId = roomIds[0]!;
    await insertAssignment(tx, {
      propertyId: ctx.propertyId,
      reservationRoomId: firstRoomId,
      roomId: room.id,
      fromDate: fromDateOnly(input.arrival),
      toDate: fromDateOnly(input.departure),
      occupancyKey: firstRoomId,
      kind: "INITIAL",
      assignedById: ctx.userId,
    });
  }
  if (input.specialRequests) {
    await insertNote(tx, {
      propertyId: ctx.propertyId,
      reservationId: reservation.id,
      kind: "NOTE",
      body: input.specialRequests,
      createdById: ctx.userId,
    });
  }
  if (deducts) await syncInventoryCounters(tx, ctx.propertyId, [demand]);

  await recordAudit(
    tx,
    { ...auditActor(ctx), businessDate },
    {
      action: "reservation.create",
      resourceType: "Reservation",
      resourceId: reservation.id,
      risk: input.override ? "HIGH" : "STANDARD",
      after: {
        confirmationNumber,
        status,
        bookingState: bookingState(status, reservationType.deductsInventory),
        rooms: input.rooms,
        reservationRoomIds: roomIds,
        arrival: input.arrival,
        departure: input.departure,
        adults: input.adults,
        children: input.children,
        guestId: guest.id,
        roomType: roomType.code,
        ratePlan: ratePlan.code,
        reservationType: reservationType.code,
        roomNumber: room?.number ?? null,
        totalPerRoom: priced.total,
        currencyCode: ctx.currencyCode,
        override: input.override,
        restrictionsOverridden: input.override ? priced.violations : [],
        ...(options.walkIn ? { walkIn: true } : {}),
        ...(options.block ? { blockId: options.block.id, groupId: options.block.groupId } : {}),
      },
      reason: input.reason ?? null,
      permission: input.override ? "reservations:override_availability" : "reservations:create",
    },
  );
  return { reservationId: reservation.id, reservationRoomIds: roomIds };
}

export async function updateReservationRoom(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: UpdateReservationRoomInput,
): Promise<ReservationDetail> {
  if (input.override) requirePermission(ctx, "reservations:override_availability");

  const reservationId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const current = await lockRoomOrThrow(tx, ctx, reservationRoomId, input.version);
    assertTransition("modify", current, businessDate);
    const before = stateOf(current);

    const next = {
      arrival: input.arrival ?? before.arrival,
      departure: input.departure ?? before.departure,
      adults: input.adults ?? current.adults,
      children: input.children ?? current.children,
      roomTypeId: input.roomTypeId ?? current.roomTypeId,
      ratePlanId: input.ratePlanId ?? current.ratePlanId,
    };
    const nights = nightCount(next.arrival, next.departure);
    if (nights < 1)
      throw new AppError("VALIDATION_FAILED", "Departure must be after arrival", {
        fields: { departure: ["Departure must be after arrival"] },
      });
    if (next.arrival !== before.arrival) assertArrivalNotPast(next.arrival, businessDate);

    const roomType = await requireRoomType(tx, ctx.propertyId, next.roomTypeId);
    assertOccupancy(roomType, next.adults, next.children);
    if (input.ratePlanId && !(await findRatePlanDefaults(tx, ctx.propertyId, input.ratePlanId)))
      throw notFound("Rate plan");
    if (input.marketCodeId && !(await findMarketCode(tx, ctx.propertyId, input.marketCodeId)))
      throw notFound("Market code");
    if (input.sourceCodeId && !(await findSourceCode(tx, ctx.propertyId, input.sourceCodeId)))
      throw notFound("Source code");
    if (input.primaryGuestId) {
      const guest = await requireGuest(tx, ctx.organizationId, input.primaryGuestId);
      if (guest.isRestricted) {
        throw new AppError(
          "BUSINESS_RULE_VIOLATION",
          "This guest profile is restricted from booking",
          { reason: "GUEST_RESTRICTED" },
        );
      }
    }

    const stayChanged =
      next.arrival !== before.arrival ||
      next.departure !== before.departure ||
      next.roomTypeId !== current.roomTypeId ||
      next.ratePlanId !== current.ratePlanId ||
      next.adults !== current.adults ||
      next.children !== current.children;
    const datesOrTypeChanged =
      next.arrival !== before.arrival ||
      next.departure !== before.departure ||
      next.roomTypeId !== current.roomTypeId;
    if (current.blockId && (datesOrTypeChanged || next.ratePlanId !== current.ratePlanId)) {
      // A pickup's dates, room type and rate belong to the block contract.
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "This reservation is picked up from a group block: change its dates, room type or rate through the group",
        { reason: "BLOCK_PICKUP_LOCKED" },
      );
    }

    let total: string | null = null;
    const consumes = consumesInventory(before.status, before.deductsInventory);
    const oldDemand = demandOf(current.roomTypeId, before.arrival, before.departure);
    const newDemand = demandOf(next.roomTypeId, next.arrival, next.departure);

    if (stayChanged) {
      const priced = await priceStay(tx, ctx, businessDate, next, {
        allowGroupRates: current.blockId !== null,
      });
      assertNoRestrictions(priced.violations, input.override);
      total = priced.total;
      if (consumes && datesOrTypeChanged) {
        // One sorted lock over old and new cells, then re-validate the new stay
        // excluding this reservation's own current nights.
        await lockInventoryForRelease(tx, ctx.propertyId, [oldDemand, newDemand]);
        await reserveInventory(tx, ctx.propertyId, [newDemand], {
          allowOverbooking: input.override,
          excludeReservationRoomIds: [current.id],
        });
      }
      await deleteNights(tx, current.id);
      await insertNights(
        tx,
        nightRows(ctx.propertyId, current.id, next, current.currencyCode, priced.nightly),
      );
    }

    let roomId = current.roomId;
    if (current.roomId && datesOrTypeChanged) {
      await releaseActiveAssignments(tx, current.id, ctx.userId, new Date());
      if (next.roomTypeId !== current.roomTypeId) {
        roomId = null; // a different room type needs a new room
      } else {
        await requireAssignableRoom(
          tx,
          ctx.propertyId,
          current.roomId,
          next.roomTypeId,
          next.arrival,
          next.departure,
        );
        await insertAssignment(tx, {
          propertyId: ctx.propertyId,
          reservationRoomId: current.id,
          roomId: current.roomId,
          fromDate: fromDateOnly(next.arrival),
          toDate: fromDateOnly(next.departure),
          occupancyKey: current.shareGroupId ?? current.id,
          kind: "INITIAL",
          assignedById: ctx.userId,
        });
      }
    }
    if (input.primaryGuestId && input.primaryGuestId !== current.primaryGuestId) {
      await replacePrimaryGuest(tx, current.id, input.primaryGuestId);
    }

    await saveVersioned(tx, current, {
      arrivalDate: fromDateOnly(next.arrival),
      departureDate: fromDateOnly(next.departure),
      adults: next.adults,
      children: next.children,
      roomTypeId: next.roomTypeId,
      rateRoomTypeId: next.roomTypeId,
      ratePlanId: next.ratePlanId,
      roomId,
      ...(input.primaryGuestId ? { primaryGuestId: input.primaryGuestId } : {}),
      ...(input.marketCodeId ? { marketCodeId: input.marketCodeId } : {}),
      ...(input.sourceCodeId ? { sourceCodeId: input.sourceCodeId } : {}),
      ...(input.eta !== undefined ? { eta: input.eta } : {}),
    });
    if (consumes && datesOrTypeChanged)
      await syncInventoryCounters(tx, ctx.propertyId, [oldDemand, newDemand]);

    const beforeValues: Record<string, unknown> = {
      arrival: before.arrival,
      departure: before.departure,
      adults: current.adults,
      children: current.children,
      roomTypeId: current.roomTypeId,
      ratePlanId: current.ratePlanId,
      primaryGuestId: current.primaryGuestId,
      marketCodeId: current.marketCodeId,
      sourceCodeId: current.sourceCodeId,
      eta: current.eta,
      roomId: current.roomId,
    };
    const afterValues: Record<string, unknown> = {
      ...next,
      primaryGuestId: input.primaryGuestId ?? current.primaryGuestId,
      marketCodeId: input.marketCodeId ?? current.marketCodeId,
      sourceCodeId: input.sourceCodeId ?? current.sourceCodeId,
      eta: input.eta !== undefined ? input.eta : current.eta,
      roomId,
    };
    const changed = Object.keys(afterValues).filter((k) => afterValues[k] !== beforeValues[k]);
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "reservation.update",
        resourceType: "ReservationRoom",
        resourceId: current.id,
        risk: input.override || changed.includes("ratePlanId") ? "HIGH" : "STANDARD",
        before: Object.fromEntries(changed.map((k) => [k, beforeValues[k]])),
        after: {
          ...Object.fromEntries(changed.map((k) => [k, afterValues[k]])),
          ...(total ? { totalPerRoom: total } : {}),
        },
        reason: input.reason ?? null,
        permission: input.override ? "reservations:override_availability" : "reservations:update",
      },
    );
    return current.reservationId;
  });
  return getReservation(ctx, reservationId);
}

/**
 * Tentative → confirmed (switch to an inventory-deducting reservation type)
 * or waitlisted → confirmed. Deducts inventory under lock.
 */
export async function confirmReservation(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: ConfirmReservationInput,
): Promise<ReservationDetail> {
  if (input.override) requirePermission(ctx, "reservations:override_availability");

  const reservationId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const current = await lockRoomOrThrow(tx, ctx, reservationRoomId, input.version);
    assertTransition("confirm", current, businessDate);
    if (current.status === "WAITLISTED") requirePermission(ctx, "reservations:waitlist");
    const before = stateOf(current);
    assertArrivalNotPast(before.arrival, businessDate);

    const type = await findReservationType(tx, ctx.propertyId, input.reservationTypeId);
    if (!type) throw notFound("Reservation type");
    if (!type.deductsInventory) {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "Choose a confirmed (inventory-deducting) reservation type",
        {
          reason: "TYPE_DOES_NOT_DEDUCT",
        },
      );
    }

    const demand = demandOf(current.roomTypeId, before.arrival, before.departure);
    await reserveInventory(tx, ctx.propertyId, [demand], {
      allowOverbooking: input.override,
      excludeReservationRoomIds: [current.id],
    });
    await saveVersioned(tx, current, { status: "RESERVED", reservationTypeId: type.id });
    await syncInventoryCounters(tx, ctx.propertyId, [demand]);

    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "reservation.confirm",
        resourceType: "ReservationRoom",
        resourceId: current.id,
        risk: input.override ? "HIGH" : "STANDARD",
        before: {
          status: current.status,
          bookingState: bookingState(before.status, before.deductsInventory),
          reservationType: current.reservationType.code,
        },
        after: { status: "RESERVED", bookingState: "CONFIRMED", reservationType: type.code },
        reason: input.reason ?? null,
        permission: input.override ? "reservations:override_availability" : "reservations:update",
      },
    );
    return current.reservationId;
  });
  return getReservation(ctx, reservationId);
}

export async function cancelReservation(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: CancelReservationInput,
): Promise<ReservationDetail> {
  return releaseReservation(ctx, reservationRoomId, input, "cancel");
}

export async function markNoShow(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: NoShowReservationInput,
): Promise<ReservationDetail> {
  return releaseReservation(ctx, reservationRoomId, input, "no_show");
}

/**
 * Cancel / no-show: status change, inventory released, room assignment
 * released, cancellation number for cancellations. Penalty postings arrive
 * with folios (Phase 6).
 */
async function releaseReservation(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: CancelReservationInput,
  action: "cancel" | "no_show",
): Promise<ReservationDetail> {
  const reservationId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const current = await lockRoomOrThrow(tx, ctx, reservationRoomId, input.version);
    assertTransition(action, current, businessDate);
    const before = stateOf(current);

    const reasonCode = await findReasonCode(
      tx,
      ctx.propertyId,
      input.reasonCodeId,
      action === "cancel" ? "CANCELLATION" : "NO_SHOW",
    );
    if (!reasonCode) {
      throw new AppError("VALIDATION_FAILED", "Choose a valid reason code", {
        fields: { reasonCodeId: ["Invalid reason"] },
      });
    }

    const consumes = consumesInventory(before.status, before.deductsInventory);
    const demand = demandOf(current.roomTypeId, before.arrival, before.departure);
    if (consumes) await lockInventoryForRelease(tx, ctx.propertyId, [demand]);

    const now = new Date();
    const cancellationNumber =
      action === "cancel" ? await allocateNumber(tx, ctx.propertyId, "cancellation") : null;
    await releaseActiveAssignments(tx, current.id, ctx.userId, now);
    await saveVersioned(
      tx,
      current,
      action === "cancel"
        ? {
            status: "CANCELLED",
            cancellationNumber,
            cancelledAt: now,
            cancelledById: ctx.userId,
            cancelReasonId: reasonCode.id,
            roomId: null,
          }
        : { status: "NO_SHOW", noShowAt: now, roomId: null },
    );
    if (consumes) await syncInventoryCounters(tx, ctx.propertyId, [demand]);

    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: action === "cancel" ? "reservation.cancel" : "reservation.no_show",
        resourceType: "ReservationRoom",
        resourceId: current.id,
        risk: "HIGH",
        before: {
          status: current.status,
          bookingState: bookingState(before.status, before.deductsInventory),
          roomId: current.roomId,
        },
        after: {
          status: action === "cancel" ? "CANCELLED" : "NO_SHOW",
          cancellationNumber,
          reasonCode: reasonCode.code,
          inventoryReleased: consumes,
        },
        reason: input.reason,
        reasonCodeId: reasonCode.id,
        permission: action === "cancel" ? "reservations:cancel" : "reservations:no_show",
      },
    );
    return current.reservationId;
  });
  return getReservation(ctx, reservationId);
}

export async function reinstateReservation(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: ReinstateReservationInput,
): Promise<ReservationDetail> {
  if (input.override) requirePermission(ctx, "reservations:override_availability");

  const reservationId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const current = await lockRoomOrThrow(tx, ctx, reservationRoomId, input.version);
    assertTransition("reinstate", current, businessDate);
    const before = stateOf(current);
    const demand = demandOf(current.roomTypeId, before.arrival, before.departure);
    if (before.deductsInventory && current.blockId) {
      // A reinstated pickup takes its room back from the block.
      await reserveBlockInventory(tx, ctx.propertyId, current.blockId, demand, {
        allowOverbooking: input.override,
      });
    } else if (before.deductsInventory) {
      await reserveInventory(tx, ctx.propertyId, [demand], { allowOverbooking: input.override });
    }
    await saveVersioned(tx, current, {
      status: "RESERVED",
      cancellationNumber: null,
      cancelledAt: null,
      cancelledById: null,
      cancelReasonId: null,
    });
    if (before.deductsInventory) await syncInventoryCounters(tx, ctx.propertyId, [demand]);

    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "reservation.reinstate",
        resourceType: "ReservationRoom",
        resourceId: current.id,
        risk: "HIGH",
        before: { status: "CANCELLED", cancellationNumber: current.cancellationNumber },
        after: {
          status: "RESERVED",
          bookingState: bookingState("RESERVED", before.deductsInventory),
          override: input.override,
        },
        reason: input.reason,
        permission: "reservations:reinstate",
      },
    );
    return current.reservationId;
  });
  return getReservation(ctx, reservationId);
}

/** Assigns (or unassigns, roomId null) a physical room for the whole stay. */
export async function assignRoom(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: AssignRoomInput,
): Promise<ReservationDetail> {
  const reservationId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const current = await lockRoomOrThrow(tx, ctx, reservationRoomId, input.version);
    assertTransition("assign_room", current, businessDate);
    if (current.status === "WAITLISTED" && input.roomId) {
      throw new AppError("BUSINESS_RULE_VIOLATION", "Waitlisted reservations cannot hold a room", {
        reason: "WAITLISTED",
      });
    }
    const { arrival, departure } = stateOf(current);
    await releaseActiveAssignments(tx, current.id, ctx.userId, new Date());
    let roomNumber: string | null = null;
    if (input.roomId) {
      const room = await requireAssignableRoom(
        tx,
        ctx.propertyId,
        input.roomId,
        current.roomTypeId,
        arrival,
        departure,
      );
      roomNumber = room.number;
      // The exclusion constraint rejects an overlapping assignment of the same room (→ 409).
      await insertAssignment(tx, {
        propertyId: ctx.propertyId,
        reservationRoomId: current.id,
        roomId: room.id,
        fromDate: fromDateOnly(arrival),
        toDate: fromDateOnly(departure),
        occupancyKey: current.shareGroupId ?? current.id,
        kind: "INITIAL",
        assignedById: ctx.userId,
      });
    }
    await saveVersioned(tx, current, { roomId: input.roomId });
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: input.roomId ? "reservation.room_assign" : "reservation.room_unassign",
        resourceType: "ReservationRoom",
        resourceId: current.id,
        before: { roomId: current.roomId },
        after: { roomId: input.roomId, roomNumber },
        permission: "rooms:assign",
      },
    );
    return current.reservationId;
  });
  return getReservation(ctx, reservationId);
}

// --- Front-office hooks -------------------------------------------------------------

export type { LockedReservationRoom };
// Called by modules/front-desk inside its transaction, after it holds the
// business-date lock. They own every write to reservation_rooms,
// room_assignments and reservation_room_nights made by the front desk.

/** Locks a reservation room FOR UPDATE and checks the client's version. */
export function lockReservationRoomForCommand(
  tx: Tx,
  ctx: PropertyContext,
  reservationRoomId: string,
  version: number,
): Promise<LockedReservationRoom> {
  return lockRoomOrThrow(tx, ctx, reservationRoomId, version);
}

/** Locks a reservation room FOR UPDATE without a version check (stay commands carry the stay's version). */
export async function lockReservationRoomById(
  tx: Tx,
  ctx: PropertyContext,
  reservationRoomId: string,
): Promise<LockedReservationRoom> {
  const room = await lockReservationRoom(tx, ctx.propertyId, reservationRoomId);
  if (!room) throw notFound("Reservation");
  return room;
}

export function assertReservationTransition(
  action: ReservationAction,
  room: LockedReservationRoom,
  businessDate: string,
): void {
  assertTransition(action, room, businessDate);
}

export function reservationStayDates(room: LockedReservationRoom): {
  arrival: string;
  departure: string;
} {
  const { arrival, departure } = stateOf(room);
  return { arrival, departure };
}

/** Validates a reason code of a front-office category for this property. */
export async function requireReasonCode(
  tx: Tx,
  propertyId: string,
  reasonCodeId: string,
  category: "ROOM_MOVE" | "EARLY_DEPARTURE",
) {
  const reasonCode = await findReasonCode(tx, propertyId, reasonCodeId, category);
  if (!reasonCode) {
    throw new AppError("VALIDATION_FAILED", "Choose a valid reason code", {
      fields: { reasonCodeId: ["Invalid reason"] },
    });
  }
  return reasonCode;
}

/**
 * RESERVED → IN_HOUSE. Assigns `roomId` for the whole stay when it is not
 * already the assigned room (the exclusion constraint rejects a room that
 * is taken for any night), re-validating type and out-of-order periods.
 */
export async function markCheckedIn(
  tx: Tx,
  ctx: PropertyContext,
  current: LockedReservationRoom,
  roomId: string,
): Promise<{ roomAssigned: boolean }> {
  const { arrival, departure } = stateOf(current);
  await requireAssignableRoom(tx, ctx.propertyId, roomId, current.roomTypeId, arrival, departure);
  const hasAssignment =
    current.roomId === roomId && (await countActiveAssignments(tx, current.id, roomId)) > 0;
  if (!hasAssignment) {
    await releaseActiveAssignments(tx, current.id, ctx.userId, new Date());
    await insertAssignment(tx, {
      propertyId: ctx.propertyId,
      reservationRoomId: current.id,
      roomId,
      fromDate: fromDateOnly(arrival),
      toDate: fromDateOnly(departure),
      occupancyKey: current.shareGroupId ?? current.id,
      kind: "INITIAL",
      assignedById: ctx.userId,
    });
  }
  await saveVersioned(tx, current, { status: "IN_HOUSE", roomId });
  return { roomAssigned: !hasAssignment };
}

/**
 * In-house room move for the remaining nights [business date, departure):
 * the current assignment is closed at the business date (history keeps
 * where the guest slept), a MOVE assignment covers the rest of the stay.
 */
export async function moveInHouseRoom(
  tx: Tx,
  ctx: PropertyContext,
  current: LockedReservationRoom,
  toRoomId: string,
  businessDate: string,
  reasonCodeId: string,
): Promise<void> {
  const { departure } = stateOf(current);
  if (departure <= businessDate) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The guest departs today; a room move applies to remaining nights only",
      { reason: "NO_REMAINING_NIGHTS" },
    );
  }
  await requireAssignableRoom(
    tx,
    ctx.propertyId,
    toRoomId,
    current.roomTypeId,
    businessDate,
    departure,
  );
  const now = new Date();
  await closeActiveAssignments(tx, current.id, ctx.userId, now, businessDate);
  await insertAssignment(tx, {
    propertyId: ctx.propertyId,
    reservationRoomId: current.id,
    roomId: toRoomId,
    fromDate: fromDateOnly(businessDate),
    toDate: fromDateOnly(departure),
    occupancyKey: current.shareGroupId ?? current.id,
    kind: "MOVE",
    reasonCodeId,
    assignedById: ctx.userId,
  });
  await saveVersioned(tx, current, { roomId: toRoomId });
}

/**
 * IN_HOUSE → CHECKED_OUT. For an early departure the unused nights
 * [business date, departure) are deleted and their inventory released under
 * lock, and the departure becomes the business date. The assignment is
 * closed at the business date.
 */
export async function markCheckedOut(
  tx: Tx,
  ctx: PropertyContext,
  current: LockedReservationRoom,
  businessDate: string,
  early: boolean,
): Promise<{ departure: string; releasedNights: number }> {
  const { departure } = stateOf(current);
  let releasedNights = 0;
  const unused = demandOf(current.roomTypeId, businessDate, departure);
  if (early) {
    await lockInventoryForRelease(tx, ctx.propertyId, [unused]);
    releasedNights = (await deleteNightsFrom(tx, current.id, fromDateOnly(businessDate))).count;
  }
  await closeActiveAssignments(tx, current.id, ctx.userId, new Date(), businessDate);
  const finalDeparture = early ? businessDate : departure;
  await saveVersioned(tx, current, {
    status: "CHECKED_OUT",
    departureDate: fromDateOnly(finalDeparture),
  });
  if (early) await syncInventoryCounters(tx, ctx.propertyId, [unused]);
  return { departure: finalDeparture, releasedNights };
}

// --- Packages (Phase 6) ------------------------------------------------------------------

/**
 * Books a package (sold separately) on a reservation room for future stay
 * nights. Package lines are priced and posted by Phase 5 billing; only
 * nights from the business date on may be booked, so a nightly posting
 * already made is never followed by a package line for the same night.
 */
export async function addReservationPackage(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: ReservationPackageInput,
): Promise<ReservationDetail> {
  const reservationId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const current = await lockReservationRoomById(tx, ctx, reservationRoomId);
    if (current.status !== "RESERVED" && current.status !== "IN_HOUSE") {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "Packages can be added to active reservations only",
        {
          reason: "RESERVATION_NOT_ACTIVE",
        },
      );
    }
    const { arrival, departure } = stateOf(current);
    const firstNight = arrival > businessDate ? arrival : businessDate;
    const lastNight = addDays(departure, -1);
    if (
      input.startDate < firstNight ||
      input.endDate > lastNight ||
      input.endDate < input.startDate
    ) {
      throw new AppError(
        "VALIDATION_FAILED",
        `Choose nights between ${firstNight} and ${lastNight}`,
        {
          fields: { startDate: [`From ${firstNight}`], endDate: [`Until ${lastNight}`] },
        },
      );
    }
    const pkg = await requireSellablePackage(tx, ctx.propertyId, input.packageId);
    const row = await insertReservationPackage(tx, {
      propertyId: ctx.propertyId,
      reservationRoomId: current.id,
      packageId: pkg.id,
      quantity: input.quantity,
      startDate: fromDateOnly(input.startDate),
      endDate: fromDateOnly(input.endDate),
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "reservation.package_add",
        resourceType: "ReservationRoom",
        resourceId: current.id,
        after: {
          reservationPackageId: row.id,
          package: pkg.code,
          quantity: input.quantity,
          startDate: input.startDate,
          endDate: input.endDate,
        },
        permission: "reservations:update",
      },
    );
    return current.reservationId;
  });
  return getReservation(ctx, reservationId);
}

/** Removes a booked package that has not reached a postable night yet. */
export async function removeReservationPackage(
  ctx: PropertyContext,
  reservationRoomId: string,
  reservationPackageId: string,
): Promise<ReservationDetail> {
  const reservationId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const current = await lockReservationRoomById(tx, ctx, reservationRoomId);
    const row = await findReservationPackage(tx, current.id, reservationPackageId);
    if (!row) throw notFound("Package");
    if (toDateOnly(row.startDate) < businessDate) {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "This package has already started; nights that may have been posted cannot be removed",
        { reason: "PACKAGE_IN_USE" },
      );
    }
    await deleteReservationPackage(tx, row.id);
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "reservation.package_remove",
        resourceType: "ReservationRoom",
        resourceId: current.id,
        before: {
          reservationPackageId: row.id,
          package: row.package.code,
          quantity: row.quantity,
          startDate: toDateOnly(row.startDate),
          endDate: toDateOnly(row.endDate),
        },
        permission: "reservations:update",
      },
    );
    return current.reservationId;
  });
  return getReservation(ctx, reservationId);
}

// --- Billing hooks ----------------------------------------------------------------------
// Called by modules/billing inside its transaction, while it holds the
// reservation room lock (lockReservationRoomById).

/** The reservation room's stay nights with their priced rate and posting state. */
export async function nightsForRoomCharges(
  tx: Tx,
  propertyId: string,
  reservationRoomId: string,
): Promise<
  {
    stayDate: string;
    rateAmount: string;
    currencyCode: string;
    adults: number;
    children: number;
    ratePlanId: string;
    posted: boolean;
  }[]
> {
  const nights = await findNightsForPosting(tx, propertyId, reservationRoomId);
  return nights.map((night) => ({
    stayDate: toDateOnly(night.stayDate),
    rateAmount: night.rateAmount.toFixed(4),
    currencyCode: night.currencyCode,
    adults: night.adults,
    children: night.children,
    ratePlanId: night.ratePlanId,
    posted: night.postedAt !== null,
  }));
}

/** Records that a night's room charge was posted (true) or reversed (false). */
export async function markNightPosting(
  tx: Tx,
  reservationRoomId: string,
  stayDate: string,
  posted: boolean,
): Promise<void> {
  const { count } = await setNightPosted(tx, reservationRoomId, fromDateOnly(stayDate), posted);
  if (count !== 1) {
    throw new AppError("CONFLICT", "The night's room charge was changed by someone else", {
      reason: "NIGHT_POSTING_CHANGED",
      stayDate,
    });
  }
}

// --- Queries --------------------------------------------------------------------------

export async function getBookingOptions(ctx: PropertyContext): Promise<BookingOptions> {
  const options = await findBookingOptions(prisma, ctx.propertyId);
  const ref = (r: { id: string; code: string; name: string }) => ({
    id: r.id,
    code: r.code,
    name: r.name,
  });
  return {
    roomTypes: options.roomTypes,
    ratePlans: options.ratePlans,
    reservationTypes: options.reservationTypes,
    marketCodes: options.marketCodes,
    sourceCodes: options.sourceCodes,
    channels: options.channels,
    reasonCodes: {
      cancellation: options.reasons.filter((r) => r.category === "CANCELLATION").map(ref),
      noShow: options.reasons.filter((r) => r.category === "NO_SHOW").map(ref),
    },
  };
}

export async function listAvailableRooms(
  ctx: PropertyContext,
  query: AvailableRoomsQuery,
): Promise<AvailableRoomView[]> {
  const rows = await findAvailableRooms(
    prisma,
    ctx.propertyId,
    query.roomTypeId,
    query.arrival,
    query.departure,
    query.excludeReservationRoomId ?? null,
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    floor: r.floor,
    housekeepingStatus: r.housekeeping_status,
    frontOfficeStatus: r.front_office_status,
    outOfService: r.out_of_service,
    isAccessible: r.is_accessible,
    isSmoking: r.is_smoking,
  }));
}

const SORTS = {
  arrival: { field: "arrivalDate", direction: "asc" },
  "-arrival": { field: "arrivalDate", direction: "desc" },
  "-created": { field: "createdAt", direction: "desc" },
} as const;

/** Server-side reservation search: filtered, keyset-paginated, bounded. */
export async function listReservations(
  ctx: PropertyContext,
  query: ListReservationsQuery,
): Promise<{ items: ReservationListItem[]; meta: CursorPageMeta }> {
  const sort = SORTS[query.sort];
  const and: Prisma.ReservationRoomWhereInput[] = [{ propertyId: ctx.propertyId }];

  if (query.state?.length) {
    and.push({
      OR: query.state.map((state): Prisma.ReservationRoomWhereInput => {
        if (state === "TENTATIVE")
          return { status: "RESERVED", reservationType: { deductsInventory: false } };
        if (state === "CONFIRMED")
          return { status: "RESERVED", reservationType: { deductsInventory: true } };
        return { status: state };
      }),
    });
  }
  if (query.q) {
    const raw = query.q.trim();
    // Every name word must match, in any order ("sofia rossi" finds "rossi sofia").
    const nameTokens = normalizeName(raw).split(" ").filter(Boolean).slice(0, 5);
    and.push({
      OR: [
        { reservation: { confirmationNumber: { startsWith: raw } } },
        { cancellationNumber: raw.toUpperCase() },
        { reservation: { externalReference: raw } },
        { room: { number: raw } },
        ...(nameTokens.length > 0
          ? [
              {
                AND: nameTokens.map((token) => ({
                  primaryGuest: { searchName: { contains: token } },
                })),
              },
            ]
          : []),
      ],
    });
  }
  const dateRange = (from?: string, to?: string) =>
    from || to
      ? { ...(from ? { gte: fromDateOnly(from) } : {}), ...(to ? { lte: fromDateOnly(to) } : {}) }
      : undefined;
  const arrivalRange = dateRange(query.arrivalFrom, query.arrivalTo);
  if (arrivalRange) and.push({ arrivalDate: arrivalRange });
  const departureRange = dateRange(query.departureFrom, query.departureTo);
  if (departureRange) and.push({ departureDate: departureRange });
  if (query.createdFrom || query.createdTo) {
    // "Created on" dates are property-local calendar days.
    and.push({
      createdAt: {
        ...(query.createdFrom ? { gte: localMidnightUtc(query.createdFrom, ctx.timezone) } : {}),
        ...(query.createdTo
          ? {
              lt: localMidnightUtc(
                toDateOnly(new Date(fromDateOnly(query.createdTo).getTime() + 86_400_000)),
                ctx.timezone,
              ),
            }
          : {}),
      },
    });
  }
  if (query.roomTypeId) and.push({ roomTypeId: query.roomTypeId });
  if (query.sourceCodeId) and.push({ sourceCodeId: query.sourceCodeId });
  if (query.channelId) and.push({ reservation: { channelId: query.channelId } });
  if (query.guestId) and.push({ primaryGuestId: query.guestId });

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor, ["v", "i"] as const);
    if (!cursor)
      throw new AppError("VALIDATION_FAILED", "Invalid cursor", {
        fields: { cursor: ["Invalid cursor"] },
      });
    const value = sort.field === "arrivalDate" ? fromDateOnly(cursor.v) : new Date(cursor.v);
    if (Number.isNaN(value.getTime())) throw new AppError("VALIDATION_FAILED", "Invalid cursor");
    const cmp = sort.direction === "asc" ? "gt" : "lt";
    and.push({
      OR: [{ [sort.field]: { [cmp]: value } }, { [sort.field]: value, id: { [cmp]: cursor.i } }],
    });
  }

  const rows = await findReservationRoomsPage(
    prisma,
    { AND: and },
    [{ [sort.field]: sort.direction }, { id: sort.direction }],
    query.limit + 1,
  );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor({
          v:
            sort.field === "arrivalDate"
              ? toDateOnly(last.arrivalDate)
              : last.createdAt.toISOString(),
          i: last.id,
        })
      : null;

  const totals = await sumNightAmounts(
    prisma,
    page.map((r) => r.id),
  );
  const minorUnits = await currencyMinorUnits(prisma, ctx.currencyCode);

  return {
    items: page.map((row) => {
      const arrival = toDateOnly(row.arrivalDate);
      const departure = toDateOnly(row.departureDate);
      return {
        reservationId: row.reservationId,
        reservationRoomId: row.id,
        confirmationNumber: row.reservation.confirmationNumber,
        displayConfirmation: displayConfirmation(
          row.reservation.confirmationNumber,
          row.lineNumber,
          row.reservation._count.rooms,
        ),
        lineNumber: row.lineNumber,
        status: row.status,
        bookingState: bookingState(row.status, row.reservationType.deductsInventory),
        guest: {
          id: row.primaryGuest.id,
          name: [row.primaryGuest.lastName, row.primaryGuest.firstName].join(", "),
          isVip: row.primaryGuest.vipLevelId !== null,
        },
        arrival,
        departure,
        nights: nightCount(arrival, departure),
        adults: row.adults,
        children: row.children,
        roomType: row.roomType,
        room: row.room,
        ratePlan: row.ratePlan,
        source: row.sourceCode,
        channel: row.reservation.channel,
        currencyCode: row.currencyCode,
        totalAmount: formatMoney(parseMoney(totals.get(row.id) ?? "0"), minorUnits),
        bookedAt: row.reservation.bookedAt.toISOString(),
      };
    }),
    meta: { nextCursor, limit: query.limit },
  };
}

export async function getReservation(
  ctx: PropertyContext,
  reservationId: string,
): Promise<ReservationDetail> {
  const reservation = await findReservationDetail(prisma, ctx.propertyId, reservationId);
  if (!reservation) throw notFound("Reservation");
  const minorUnits = await currencyMinorUnits(prisma, ctx.currencyCode);
  const history = await findAuditHistory(prisma, ctx.organizationId, [
    reservation.id,
    ...reservation.rooms.map((r) => r.id),
    ...reservation.rooms.flatMap((r) => (r.stay ? [r.stay.id] : [])),
  ]);
  const userIds = [
    ...new Set([
      reservation.bookedById,
      ...history.map((h) => h.userId).filter((id): id is string => !!id),
    ]),
  ];
  const names = new Map(
    (await findUserNames(prisma, ctx.organizationId, userIds)).map((u) => [u.id, u.displayName]),
  );
  const can = (permission: Permission) => hasPermission(ctx.access, ctx.propertyId, permission);
  const businessDate = ctx.businessDate;
  const roomCount = reservation.rooms.length;

  const rooms: ReservationRoomDetail[] = reservation.rooms.map((room) => {
    const arrival = toDateOnly(room.arrivalDate);
    const departure = toDateOnly(room.departureDate);
    const state = {
      status: room.status as ReservationStatus,
      deductsInventory: room.reservationType.deductsInventory,
      arrival,
      departure,
    };
    const allowed = (action: ReservationAction, permission: Permission) =>
      businessDate !== null &&
      can(permission) &&
      transitionProblem(action, state, businessDate) === null;
    const nightly = room.nights.map((n) => ({
      date: toDateOnly(n.stayDate),
      amount: formatMoney(parseMoney(n.rateAmount.toFixed(4)), minorUnits),
      roomTypeCode: n.roomType.code,
      ratePlanCode: n.ratePlan.code,
    }));
    return {
      id: room.id,
      lineNumber: room.lineNumber,
      displayConfirmation: displayConfirmation(
        reservation.confirmationNumber,
        room.lineNumber,
        roomCount,
      ),
      version: room.version,
      status: room.status,
      bookingState: bookingState(room.status, room.reservationType.deductsInventory),
      primaryGuest: {
        id: room.primaryGuest.id,
        name: [room.primaryGuest.title, room.primaryGuest.firstName, room.primaryGuest.lastName]
          .filter(Boolean)
          .join(" "),
        profileNumber: room.primaryGuest.profileNumber,
        email: room.primaryGuest.primaryEmail,
        phone: room.primaryGuest.primaryPhone,
      },
      arrival,
      departure,
      nights: nightCount(arrival, departure),
      adults: room.adults,
      children: room.children,
      eta: room.eta,
      roomType: room.roomType,
      room: room.room,
      ratePlan: room.ratePlan,
      reservationType: room.reservationType,
      marketCode: room.marketCode,
      sourceCode: room.sourceCode,
      cancellationPolicy: room.cancellationPolicy,
      currencyCode: room.currencyCode,
      totalAmount: formatMoney(
        sum(room.nights.map((n) => parseMoney(n.rateAmount.toFixed(4)))),
        minorUnits,
      ),
      nightly,
      cancellation:
        room.cancellationNumber && room.cancelledAt
          ? {
              number: room.cancellationNumber,
              at: room.cancelledAt.toISOString(),
              reason: room.cancelReason,
            }
          : null,
      noShowAt: room.noShowAt?.toISOString() ?? null,
      stay: room.stay
        ? {
            id: room.stay.id,
            status: room.stay.status,
            checkedInAt: room.stay.checkedInAt.toISOString(),
            checkedOutAt: room.stay.checkedOutAt?.toISOString() ?? null,
          }
        : null,
      group: room.block
        ? {
            id: room.block.group.id,
            code: room.block.group.code,
            name: room.block.group.name,
            blockId: room.block.id,
            blockCode: room.block.code,
          }
        : null,
      packages: room.packages.map((p) => ({
        id: p.id,
        code: p.package.code,
        name: p.package.name,
        postingType: p.package.postingType,
        quantity: p.quantity,
        startDate: toDateOnly(p.startDate),
        endDate: toDateOnly(p.endDate),
      })),
      allowedActions: {
        modify: allowed("modify", "reservations:update"),
        confirm: allowed("confirm", "reservations:update"),
        cancel: allowed("cancel", "reservations:cancel"),
        noShow: allowed("no_show", "reservations:no_show"),
        reinstate: allowed("reinstate", "reservations:reinstate"),
        assignRoom: allowed("assign_room", "rooms:assign"),
        checkIn: allowed("check_in", "frontdesk:checkin"),
        checkOut: allowed("check_out", "frontdesk:checkout"),
        moveRoom: allowed("room_move", "rooms:assign"),
        managePackages:
          businessDate !== null &&
          can("reservations:update") &&
          (room.status === "RESERVED" || room.status === "IN_HOUSE") &&
          departure > businessDate,
      },
    };
  });

  return {
    id: reservation.id,
    confirmationNumber: reservation.confirmationNumber,
    bookedAt: reservation.bookedAt.toISOString(),
    bookedBy: names.get(reservation.bookedById) ?? null,
    channel: reservation.channel,
    externalReference: reservation.externalReference,
    businessDate,
    rooms,
    notes: reservation.notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
    history: history.map((h) => ({
      id: h.id,
      at: h.createdAt.toISOString(),
      action: h.action,
      userDisplayName: h.userId ? (names.get(h.userId) ?? null) : null,
      risk: h.risk,
      reason: h.reason,
      before: h.before,
      after: h.after,
    })),
  };
}
