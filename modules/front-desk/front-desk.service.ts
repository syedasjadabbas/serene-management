import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { AppError, forbidden, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasPermission } from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { recordAudit, resourceHistory, userDisplayNames } from "@/modules/audit/audit.service";
import { fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { normalizeName } from "@/modules/guests/guests.policy";
import { frontOfficeRules } from "@/modules/properties/properties.service";
import { displayConfirmation, nightCount } from "@/modules/reservations/reservations.policy";
import {
  assertReservationTransition,
  createReservationInTx,
  listAvailableRooms,
  lockReservationRoomById,
  lockReservationRoomForCommand,
  markCheckedIn,
  markCheckedOut,
  moveInHouseRoom,
  requireReasonCode,
  reservationStayDates,
  type LockedReservationRoom,
} from "@/modules/reservations/reservations.service";
import {
  type RoomBoardStatus,
  type RoomReadiness,
  type RoomStatusSnapshot,
  READINESS_LABELS,
  isOverridableReadiness,
  roomBoardStatus,
  roomReadiness,
} from "@/modules/rooms/rooms.policy";
import {
  type LockedRoom,
  changeRoomStatus,
  lockRoomsForUpdate,
  roomStatusHistory,
} from "@/modules/rooms/rooms.service";
import type { CursorPageMeta } from "@/types/api";
import {
  type StayStatus,
  arrivalState,
  checkoutTiming,
  stayTransitionProblem,
} from "./front-desk.policy";
import {
  type ArrivalSqlRow,
  type StaySqlRow,
  findArrivals,
  findOperationalReasonCodes,
  findReservationRoomForOptions,
  findRoomBoard,
  findStayDetail,
  findStayRef,
  findStayRows,
  findSummaryCounts,
  insertStay,
  lockStay,
  updateStayVersioned,
} from "./front-desk.repository";
import type {
  ArrivalsQuery,
  CheckInInput,
  CheckOutInput,
  DeparturesQuery,
  InHouseQuery,
  RoomBoardQuery,
  RoomMoveInput,
  WalkInInput,
} from "./front-desk.schema";
import type {
  ArrivalRow,
  FrontDeskGuest,
  FrontDeskSummary,
  RoomBoardRow,
  RoomOption,
  StayDetail,
  StayRow,
} from "./front-desk.types";

/**
 * Front desk (docs/PMS_WORKFLOWS.md §5–§9): check-in, walk-in, in-house room
 * moves and check-out, plus the operational lists.
 *
 * Every command runs in one transaction in the documented lock order:
 * business date (FOR SHARE) → reservation room (FOR UPDATE) → stay (FOR
 * UPDATE) → inventory cells → property sequence → rooms (FOR UPDATE, id
 * order). The room lock serializes everything that puts a guest into or
 * takes a guest out of a room; the stays_one_in_house_per_room index and the
 * room_assignments_no_overlap constraint are the database-level backstop.
 *
 * Settlement (folio balances, payments, deposits) is Phase 5: check-out
 * records the operational departure only.
 */

// --- Helpers ------------------------------------------------------------------------

function requirePermission(ctx: PropertyContext, permission: Permission) {
  if (!hasPermission(ctx.access, ctx.propertyId, permission)) throw forbidden(permission);
}

/** Business date for read models (commands lock it instead). */
function requireBusinessDate(ctx: PropertyContext): string {
  if (!ctx.businessDate) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The property business date has not been initialized",
    );
  }
  return ctx.businessDate;
}

function guestName(row: { title?: string | null; first_name: string; last_name: string }) {
  return `${row.last_name}, ${row.first_name}`;
}

function searchOf(q: string | undefined) {
  if (!q) return null;
  return { tokens: normalizeName(q).split(" ").filter(Boolean).slice(0, 5), raw: q.trim() };
}

function cursorOf(cursor: string | undefined) {
  if (!cursor) return null;
  const decoded = decodeCursor(cursor, ["v", "i"] as const);
  if (!decoded) throw new AppError("VALIDATION_FAILED", "Invalid cursor");
  return decoded;
}

function page<Row extends { search_name: string }, Item>(
  rows: Row[],
  limit: number,
  idOf: (row: Row) => string,
  map: (row: Row) => Item,
): { items: Item[]; meta: CursorPageMeta } {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible[visible.length - 1];
  return {
    items: visible.map(map),
    meta: {
      nextCursor: hasMore && last ? encodeCursor({ v: last.search_name, i: idOf(last) }) : null,
      limit,
    },
  };
}

function readinessOf(
  room: {
    housekeepingStatus: string;
    frontOfficeStatus: string;
    outOfOrder: boolean;
  },
  requireInspected: boolean,
): RoomReadiness {
  return roomReadiness(room as RoomStatusSnapshot, requireInspected);
}

/**
 * Throws unless the locked room can take the guest now. Occupied is a 409
 * (another guest is in the room); out of order and not ready are 422;
 * dirty / uninspected rooms are accepted only with an explicit override.
 */
function assertRoomUsable(room: LockedRoom, requireInspected: boolean, acceptNotReady: boolean) {
  if (!room.active) throw notFound("Room");
  const readiness = roomReadiness(room, requireInspected);
  if (readiness === "READY") return readiness;
  if (readiness === "OCCUPIED") {
    throw new AppError("CONFLICT", `Room ${room.number} is occupied`, {
      reason: "ROOM_OCCUPIED",
      roomNumber: room.number,
    });
  }
  if (readiness === "OUT_OF_ORDER") {
    throw new AppError("BUSINESS_RULE_VIOLATION", `Room ${room.number} is out of order`, {
      reason: "ROOM_OUT_OF_ORDER",
      roomNumber: room.number,
    });
  }
  if (isOverridableReadiness(readiness) && acceptNotReady) return readiness;
  throw new AppError(
    "BUSINESS_RULE_VIOLATION",
    `Room ${room.number} is not ready (${READINESS_LABELS[readiness].toLowerCase()})`,
    { reason: "ROOM_NOT_READY", readiness, roomNumber: room.number },
  );
}

function assertStay(
  stay: { status: StayStatus; version: number } | null,
  version: number,
  action: "check_out" | "room_move",
) {
  if (!stay) throw notFound("Stay");
  if (stay.version !== version) throw staleVersion("Stay");
  const problem = stayTransitionProblem(action, stay.status);
  if (problem) {
    throw new AppError("INVALID_STATE_TRANSITION", problem, { action, status: stay.status });
  }
}

// --- Commands -----------------------------------------------------------------------

/**
 * Check-in inside the caller's transaction: RESERVED → IN_HOUSE, stay
 * created, room assigned if needed and marked occupied, audited.
 */
async function checkInInTx(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  current: LockedReservationRoom,
  input: { roomId?: string; acceptNotReady: boolean; reason?: string },
  walkIn = false,
): Promise<string> {
  assertReservationTransition("check_in", current, businessDate);
  const roomId = input.roomId ?? current.roomId;
  if (!roomId) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Assign a room before checking the guest in", {
      reason: "ROOM_REQUIRED",
    });
  }
  if (roomId !== current.roomId) requirePermission(ctx, "rooms:assign");
  if (input.acceptNotReady) requirePermission(ctx, "rooms:update_status");

  const rules = await frontOfficeRules(tx, ctx.propertyId);
  const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [roomId]);
  const room = rooms.get(roomId)!;
  const readiness = assertRoomUsable(room, rules.requireInspectedForCheckIn, input.acceptNotReady);

  const { roomAssigned } = await markCheckedIn(tx, ctx, current, roomId);
  const stay = await insertStay(tx, {
    propertyId: ctx.propertyId,
    reservationRoomId: current.id,
    primaryGuestId: current.primaryGuestId,
    roomId,
    status: "IN_HOUSE",
    checkedInAt: new Date(),
    checkedInById: ctx.userId,
    arrivalBusinessDate: fromDateOnly(businessDate),
  });
  await changeRoomStatus(
    tx,
    { propertyId: ctx.propertyId, userId: ctx.userId },
    room,
    { frontOfficeStatus: "OCCUPIED" },
    "CHECK_IN",
    businessDate,
  );

  const notReadyAccepted = readiness !== "READY";
  await recordAudit(
    tx,
    { ...auditActor(ctx), businessDate },
    {
      action: "stay.check_in",
      resourceType: "Stay",
      resourceId: stay.id,
      risk: notReadyAccepted ? "HIGH" : "STANDARD",
      before: {
        reservationStatus: "RESERVED",
        roomId: current.roomId,
        roomFrontOfficeStatus: room.frontOfficeStatus,
        roomHousekeepingStatus: room.housekeepingStatus,
      },
      after: {
        reservationStatus: "IN_HOUSE",
        stayStatus: "IN_HOUSE",
        reservationRoomId: current.id,
        confirmation: current.reservation.confirmationNumber,
        roomId,
        roomNumber: room.number,
        roomAssigned,
        roomFrontOfficeStatus: "OCCUPIED",
        arrivalBusinessDate: businessDate,
        ...(notReadyAccepted ? { acceptedReadiness: readiness } : {}),
        ...(walkIn ? { walkIn: true } : {}),
      },
      reason: input.reason ?? null,
      permission: notReadyAccepted ? "rooms:update_status" : "frontdesk:checkin",
    },
  );
  return stay.id;
}

export async function checkIn(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: CheckInInput,
): Promise<StayDetail> {
  const stayId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const current = await lockReservationRoomForCommand(tx, ctx, reservationRoomId, input.version);
    return checkInInTx(tx, ctx, businessDate, current, input);
  });
  return getStay(ctx, stayId);
}

/**
 * Walk-in: the regular booking (pricing, availability, restrictions,
 * confirmation number) and the check-in in one transaction, so a failed
 * check-in leaves no reservation behind.
 */
export async function walkIn(ctx: PropertyContext, input: WalkInInput): Promise<StayDetail> {
  requirePermission(ctx, "reservations:create");
  const stayId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    if (input.arrival !== businessDate) {
      throw new AppError("VALIDATION_FAILED", "A walk-in arrives on the business date", {
        fields: { arrival: [`Arrival must be ${businessDate}`] },
      });
    }
    const created = await createReservationInTx(tx, ctx, businessDate, input, { walkIn: true });
    const current = await lockReservationRoomById(tx, ctx, created.reservationRoomIds[0]!);
    return checkInInTx(
      tx,
      ctx,
      businessDate,
      current,
      { roomId: input.roomId, acceptNotReady: false },
      true,
    );
  });
  return getStay(ctx, stayId);
}

/** In-house move to another room of the booked type for the remaining nights. */
export async function moveRoom(
  ctx: PropertyContext,
  stayId: string,
  input: RoomMoveInput,
): Promise<StayDetail> {
  if (input.acceptNotReady) requirePermission(ctx, "rooms:update_status");
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const ref = await findStayRef(tx, ctx.propertyId, stayId);
    if (!ref) throw notFound("Stay");
    const current = await lockReservationRoomById(tx, ctx, ref.reservationRoomId);
    const stay = await lockStay(tx, ctx.propertyId, stayId);
    assertStay(stay, input.version, "room_move");
    assertReservationTransition("room_move", current, businessDate);
    if (input.roomId === stay!.room_id) {
      throw new AppError("VALIDATION_FAILED", "Choose a different room", {
        fields: { roomId: ["The guest is already in this room"] },
      });
    }
    const reasonCode = await requireReasonCode(tx, ctx.propertyId, input.reasonCodeId, "ROOM_MOVE");

    const rules = await frontOfficeRules(tx, ctx.propertyId);
    const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [
      stay!.room_id,
      input.roomId,
    ]);
    const from = rooms.get(stay!.room_id)!;
    const to = rooms.get(input.roomId)!;
    const readiness = assertRoomUsable(to, rules.requireInspectedForCheckIn, input.acceptNotReady);

    await moveInHouseRoom(tx, ctx, current, to.id, businessDate, reasonCode.id);
    const { count } = await updateStayVersioned(tx, stay!.id, stay!.version, { roomId: to.id });
    if (count !== 1) throw staleVersion("Stay");

    const actor = { propertyId: ctx.propertyId, userId: ctx.userId };
    // The vacated room was used by the guest: vacant and dirty until housekeeping (Phase 4).
    await changeRoomStatus(
      tx,
      actor,
      from,
      { frontOfficeStatus: "VACANT", housekeepingStatus: "DIRTY" },
      "ROOM_MOVE",
      businessDate,
    );
    await changeRoomStatus(
      tx,
      actor,
      to,
      { frontOfficeStatus: "OCCUPIED" },
      "ROOM_MOVE",
      businessDate,
    );

    const notReadyAccepted = readiness !== "READY";
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "stay.room_move",
        resourceType: "Stay",
        resourceId: stay!.id,
        // Room changes are high-risk (Guide §29, PMS_WORKFLOWS §8).
        risk: "HIGH",
        before: { roomId: from.id, roomNumber: from.number },
        after: {
          roomId: to.id,
          roomNumber: to.number,
          reservationRoomId: current.id,
          effectiveFrom: businessDate,
          reasonCode: reasonCode.code,
          vacatedRoomHousekeepingStatus: "DIRTY",
          ...(notReadyAccepted ? { acceptedReadiness: readiness } : {}),
        },
        reason: input.reason ?? null,
        reasonCodeId: reasonCode.id,
        permission: notReadyAccepted ? "rooms:update_status" : "rooms:assign",
      },
    );
  });
  return getStay(ctx, stayId);
}

/**
 * Operational check-out: IN_HOUSE → CHECKED_OUT, room vacant and dirty,
 * departure business date recorded. An early departure (confirmed by the
 * client with a reason code) releases the unused nights. Settlement of the
 * guest's account is Phase 5 (PropertyConfiguration.requireZeroBalanceCheckout
 * is enforced here once folios exist).
 */
export async function checkOut(
  ctx: PropertyContext,
  stayId: string,
  input: CheckOutInput,
): Promise<StayDetail> {
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const ref = await findStayRef(tx, ctx.propertyId, stayId);
    if (!ref) throw notFound("Stay");
    const current = await lockReservationRoomById(tx, ctx, ref.reservationRoomId);
    const stay = await lockStay(tx, ctx.propertyId, stayId);
    assertStay(stay, input.version, "check_out");
    assertReservationTransition("check_out", current, businessDate);

    const dates = reservationStayDates(current);
    const timing = checkoutTiming(dates, businessDate);
    if (timing === "SAME_DAY") {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "The guest checked in today and has not used a night yet. A same-day departure needs a reverse check-in, which is not available yet.",
        { reason: "SAME_DAY_CHECK_OUT" },
      );
    }
    const early = timing === "EARLY";
    if (early && !input.earlyDeparture) {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        `The guest is booked until ${dates.departure}. Confirm the early departure to check out today.`,
        { reason: "EARLY_DEPARTURE_NOT_CONFIRMED", departure: dates.departure },
      );
    }
    const reasonCode =
      early && input.reasonCodeId
        ? await requireReasonCode(tx, ctx.propertyId, input.reasonCodeId, "EARLY_DEPARTURE")
        : null;

    const result = await markCheckedOut(tx, ctx, current, businessDate, early);
    const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [stay!.room_id]);
    const room = rooms.get(stay!.room_id)!;
    await changeRoomStatus(
      tx,
      { propertyId: ctx.propertyId, userId: ctx.userId },
      room,
      { frontOfficeStatus: "VACANT", housekeepingStatus: "DIRTY" },
      "CHECK_OUT",
      businessDate,
    );
    const { count } = await updateStayVersioned(tx, stay!.id, stay!.version, {
      status: "CHECKED_OUT",
      checkedOutAt: new Date(),
      checkedOutById: ctx.userId,
      departureBusinessDate: fromDateOnly(businessDate),
    });
    if (count !== 1) throw staleVersion("Stay");

    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "stay.check_out",
        resourceType: "Stay",
        resourceId: stay!.id,
        risk: early ? "HIGH" : "STANDARD",
        before: {
          stayStatus: "IN_HOUSE",
          reservationStatus: "IN_HOUSE",
          departure: dates.departure,
          roomFrontOfficeStatus: room.frontOfficeStatus,
          roomHousekeepingStatus: room.housekeepingStatus,
        },
        after: {
          stayStatus: "CHECKED_OUT",
          reservationStatus: "CHECKED_OUT",
          reservationRoomId: current.id,
          roomNumber: room.number,
          departure: result.departure,
          departureBusinessDate: businessDate,
          timing,
          roomFrontOfficeStatus: "VACANT",
          roomHousekeepingStatus: "DIRTY",
          ...(early ? { releasedNights: result.releasedNights, reasonCode: reasonCode?.code } : {}),
        },
        reason: input.reason ?? null,
        reasonCodeId: reasonCode?.id ?? null,
        permission: "frontdesk:checkout",
      },
    );
  });
  return getStay(ctx, stayId);
}

// --- Queries ------------------------------------------------------------------------

export async function getSummary(ctx: PropertyContext): Promise<FrontDeskSummary> {
  const businessDate = requireBusinessDate(ctx);
  const counts = await findSummaryCounts(prisma, ctx.propertyId, businessDate);
  const rules = await frontOfficeRules(prisma, ctx.propertyId);
  const board = await findRoomBoard(prisma, ctx.propertyId, businessDate, null);
  const rooms: Record<RoomBoardStatus, number> = {
    OUT_OF_ORDER: 0,
    OCCUPIED: 0,
    VACANT_READY: 0,
    VACANT_NOT_READY: 0,
  };
  for (const row of board) {
    rooms[roomBoardStatus(boardSnapshot(row), rules.requireInspectedForCheckIn)] += 1;
  }
  return {
    businessDate,
    arrivals: {
      total: counts.arrivals_pending + counts.arrivals_checked_in,
      pending: counts.arrivals_pending,
      unassigned: counts.arrivals_unassigned,
      checkedIn: counts.arrivals_checked_in,
    },
    inHouse: {
      total: counts.in_house,
      arrivedToday: counts.in_house_arrived_today,
      dueOut: counts.due_out,
    },
    departures: { dueOut: counts.due_out, departed: counts.departed },
    rooms: { ...rooms, total: board.length },
  };
}

function boardSnapshot(row: {
  housekeeping_status: string;
  front_office_status: string;
  out_of_order: boolean;
}): RoomStatusSnapshot {
  return {
    housekeepingStatus: row.housekeeping_status as RoomStatusSnapshot["housekeepingStatus"],
    frontOfficeStatus: row.front_office_status as RoomStatusSnapshot["frontOfficeStatus"],
    outOfOrder: row.out_of_order,
  };
}

function guestOf(row: {
  guest_id: string;
  first_name: string;
  last_name: string;
  vip_code: string | null;
}): FrontDeskGuest {
  return { id: row.guest_id, name: guestName(row), vip: row.vip_code };
}

export async function listArrivals(
  ctx: PropertyContext,
  query: ArrivalsQuery,
): Promise<{ items: ArrivalRow[]; meta: CursorPageMeta }> {
  const businessDate = requireBusinessDate(ctx);
  const rules = await frontOfficeRules(prisma, ctx.propertyId);
  const rows = await findArrivals(prisma, ctx.propertyId, businessDate, {
    filter: query.filter,
    search: searchOf(query.q),
    cursor: cursorOf(query.cursor),
    limit: query.limit,
  });
  return page(
    rows,
    query.limit,
    (r) => r.reservation_room_id,
    (row: ArrivalSqlRow) => {
      const room =
        row.room_id && row.room_number && row.housekeeping_status && row.front_office_status
          ? {
              id: row.room_id,
              number: row.room_number,
              housekeepingStatus: row.housekeeping_status,
              frontOfficeStatus: row.front_office_status,
              readiness: readinessOf(
                {
                  housekeepingStatus: row.housekeeping_status,
                  frontOfficeStatus: row.front_office_status,
                  outOfOrder: row.room_out_of_order,
                },
                rules.requireInspectedForCheckIn,
              ),
            }
          : null;
      const arrival = toDateOnly(row.arrival_date);
      const departure = toDateOnly(row.departure_date);
      return {
        reservationRoomId: row.reservation_room_id,
        reservationId: row.reservation_id,
        confirmation: displayConfirmation(row.confirmation_number, row.line_number, row.room_count),
        version: row.version,
        status: row.status,
        state: arrivalState({
          status: row.status,
          deductsInventory: row.deducts_inventory,
          hasRoom: room !== null,
          readiness: room?.readiness ?? null,
        }),
        guest: guestOf(row),
        arrival,
        departure,
        nights: nightCount(arrival, departure),
        adults: row.adults,
        children: row.children,
        eta: row.eta,
        roomType: { id: row.room_type_id, code: row.room_type_code, name: row.room_type_name },
        room,
        reservationType: {
          code: row.reservation_type_code,
          deductsInventory: row.deducts_inventory,
        },
        isWalkIn: row.is_walk_in,
        latestNote: row.latest_note,
        stayId: row.stay_id,
      };
    },
  );
}

function stayRowOf(row: StaySqlRow, businessDate: string): StayRow {
  const arrival = toDateOnly(row.arrival_date);
  const departure = toDateOnly(row.departure_date);
  return {
    stayId: row.stay_id,
    stayStatus: row.stay_status,
    version: row.stay_version,
    reservationRoomId: row.reservation_room_id,
    reservationId: row.reservation_id,
    confirmation: displayConfirmation(row.confirmation_number, row.line_number, row.room_count),
    guest: guestOf(row),
    room: {
      id: row.room_id,
      number: row.room_number,
      housekeepingStatus: row.housekeeping_status,
      frontOfficeStatus: row.front_office_status,
    },
    roomType: { id: row.room_type_id, code: row.room_type_code, name: row.room_type_name },
    arrival,
    departure,
    nights: nightCount(arrival, departure),
    adults: row.adults,
    children: row.children,
    checkedInAt: row.checked_in_at.toISOString(),
    checkedOutAt: row.checked_out_at?.toISOString() ?? null,
    departureBusinessDate: row.departure_business_date
      ? toDateOnly(row.departure_business_date)
      : null,
    checkoutTiming:
      row.stay_status === "IN_HOUSE" ? checkoutTiming({ arrival, departure }, businessDate) : null,
    latestNote: row.latest_note,
  };
}

export async function listInHouse(
  ctx: PropertyContext,
  query: InHouseQuery,
): Promise<{ items: StayRow[]; meta: CursorPageMeta }> {
  const businessDate = requireBusinessDate(ctx);
  const selection = { list: "in_house", filter: query.filter } as const;
  const rows = await findStayRows(prisma, ctx.propertyId, businessDate, selection, {
    search: searchOf(query.q),
    cursor: cursorOf(query.cursor),
    limit: query.limit,
  });
  return page(
    rows,
    query.limit,
    (r) => r.stay_id,
    (row) => stayRowOf(row, businessDate),
  );
}

/** Due out (in house, departing on or before the business date) and departed today. */
export async function listDepartures(
  ctx: PropertyContext,
  query: DeparturesQuery,
): Promise<{ items: StayRow[]; meta: CursorPageMeta }> {
  const businessDate = requireBusinessDate(ctx);
  const selection = { list: "departures", filter: query.filter } as const;
  const rows = await findStayRows(prisma, ctx.propertyId, businessDate, selection, {
    search: searchOf(query.q),
    cursor: cursorOf(query.cursor),
    limit: query.limit,
  });
  return page(
    rows,
    query.limit,
    (r) => r.stay_id,
    (row) => stayRowOf(row, businessDate),
  );
}

export async function listRoomBoard(
  ctx: PropertyContext,
  query: RoomBoardQuery,
): Promise<RoomBoardRow[]> {
  const businessDate = requireBusinessDate(ctx);
  const rules = await frontOfficeRules(prisma, ctx.propertyId);
  const rows = await findRoomBoard(prisma, ctx.propertyId, businessDate, query.roomTypeId ?? null);
  const items = rows.map((row): RoomBoardRow => {
    const snapshot = boardSnapshot(row);
    return {
      id: row.id,
      number: row.number,
      floor: row.floor,
      roomType: { id: row.room_type_id, code: row.room_type_code },
      housekeepingStatus: row.housekeeping_status,
      frontOfficeStatus: row.front_office_status,
      outOfOrder: row.out_of_order,
      status: roomBoardStatus(snapshot, rules.requireInspectedForCheckIn),
      readiness: roomReadiness(snapshot, rules.requireInspectedForCheckIn),
      inHouse:
        row.stay_id && row.stay_guest && row.stay_departure
          ? {
              stayId: row.stay_id,
              guestName: row.stay_guest,
              departure: toDateOnly(row.stay_departure),
            }
          : null,
      arriving:
        row.arriving_reservation_room_id && row.arriving_reservation_id && row.arriving_guest
          ? {
              reservationId: row.arriving_reservation_id,
              reservationRoomId: row.arriving_reservation_room_id,
              guestName: row.arriving_guest,
            }
          : null,
    };
  });
  const matches: Record<RoomBoardQuery["filter"], (r: RoomBoardRow) => boolean> = {
    all: () => true,
    vacant_ready: (r) => r.status === "VACANT_READY",
    vacant_not_ready: (r) => r.status === "VACANT_NOT_READY",
    occupied: (r) => r.status === "OCCUPIED",
    out_of_order: (r) => r.status === "OUT_OF_ORDER",
    arriving: (r) => r.arriving !== null,
  };
  return items.filter(matches[query.filter]);
}

/**
 * Rooms a reservation room can use now: the booked room type, free for the
 * nights still ahead ([max(arrival, business date), departure)), with
 * readiness. For an in-house guest the current room is excluded.
 */
export async function listRoomOptions(
  ctx: PropertyContext,
  reservationRoomId: string,
): Promise<RoomOption[]> {
  const businessDate = requireBusinessDate(ctx);
  const target = await findReservationRoomForOptions(prisma, ctx.propertyId, reservationRoomId);
  if (!target) throw notFound("Reservation");
  const arrival = toDateOnly(target.arrivalDate);
  const departure = toDateOnly(target.departureDate);
  const from = arrival > businessDate ? arrival : businessDate;
  if (departure <= from) return [];
  const rules = await frontOfficeRules(prisma, ctx.propertyId);
  const rooms = await listAvailableRooms(ctx, {
    roomTypeId: target.roomTypeId,
    arrival: from,
    departure,
    excludeReservationRoomId: target.id,
  });
  // Rooms out of order for any remaining night are already excluded by the query.
  const options = rooms
    .filter((room) => !(target.status === "IN_HOUSE" && room.id === target.roomId))
    .map((room) => ({
      id: room.id,
      number: room.number,
      floor: room.floor,
      housekeepingStatus: room.housekeepingStatus,
      frontOfficeStatus: room.frontOfficeStatus,
      readiness: readinessOf(
        {
          housekeepingStatus: room.housekeepingStatus,
          frontOfficeStatus: room.frontOfficeStatus,
          outOfOrder: false,
        },
        rules.requireInspectedForCheckIn,
      ),
      isAccessible: room.isAccessible,
      isSmoking: room.isSmoking,
    }));
  const rank: Record<RoomReadiness, number> = {
    READY: 0,
    NOT_INSPECTED: 1,
    DIRTY: 2,
    OCCUPIED: 3,
    OUT_OF_ORDER: 4,
  };
  return options.sort((a, b) => rank[a.readiness] - rank[b.readiness]);
}

export async function getStay(ctx: PropertyContext, stayId: string): Promise<StayDetail> {
  const stay = await findStayDetail(prisma, ctx.propertyId, stayId);
  if (!stay) throw notFound("Stay");
  const rr = stay.reservationRoom;
  const arrival = toDateOnly(rr.arrivalDate);
  const departure = toDateOnly(rr.departureDate);
  const businessDate = ctx.businessDate;

  const history = await resourceHistory(prisma, ctx.organizationId, [stay.id, rr.id]);
  // Status changes of the rooms this stay used, while the guest was in house.
  const usedRooms = [...new Set([stay.room.id, ...rr.assignments.map((a) => a.roomId)])];
  const until = stay.checkedOutAt?.toISOString() ?? null;
  const statusChanges = (await roomStatusHistory(prisma, ctx.propertyId, usedRooms, 100)).filter(
    (c) => c.at >= stay.checkedInAt.toISOString() && (until === null || c.at <= until),
  );
  const reasons = await findOperationalReasonCodes(prisma, ctx.propertyId);
  const names = await userDisplayNames(prisma, ctx.organizationId, [
    stay.checkedInById,
    ...(stay.checkedOutById ? [stay.checkedOutById] : []),
    ...rr.assignments.map((a) => a.assignedById),
    ...statusChanges.map((c) => c.changedById).filter((id): id is string => !!id),
  ]);
  const can = (permission: Permission) => hasPermission(ctx.access, ctx.propertyId, permission);
  const inHouse = stay.status === "IN_HOUSE";
  const timing =
    inHouse && businessDate ? checkoutTiming({ arrival, departure }, businessDate) : null;
  const ref = (r: { id: string; code: string; name: string }) => ({
    id: r.id,
    code: r.code,
    name: r.name,
  });

  return {
    id: stay.id,
    status: stay.status,
    version: stay.version,
    businessDate,
    reservationId: rr.reservationId,
    reservationRoomId: rr.id,
    confirmation: displayConfirmation(
      rr.reservation.confirmationNumber,
      rr.lineNumber,
      rr.reservation._count.rooms,
    ),
    guest: {
      id: stay.primaryGuest.id,
      name: [stay.primaryGuest.title, stay.primaryGuest.firstName, stay.primaryGuest.lastName]
        .filter(Boolean)
        .join(" "),
      vip: stay.primaryGuest.vipLevel?.code ?? null,
      profileNumber: stay.primaryGuest.profileNumber,
      email: stay.primaryGuest.primaryEmail,
      phone: stay.primaryGuest.primaryPhone,
    },
    room: stay.room,
    roomType: rr.roomType,
    ratePlan: rr.ratePlan,
    arrival,
    departure,
    nights: nightCount(arrival, departure),
    adults: rr.adults,
    children: rr.children,
    isWalkIn: rr.isWalkIn,
    checkedInAt: stay.checkedInAt.toISOString(),
    checkedInBy: names.get(stay.checkedInById) ?? null,
    arrivalBusinessDate: toDateOnly(stay.arrivalBusinessDate),
    checkedOutAt: stay.checkedOutAt?.toISOString() ?? null,
    checkedOutBy: stay.checkedOutById ? (names.get(stay.checkedOutById) ?? null) : null,
    departureBusinessDate: stay.departureBusinessDate
      ? toDateOnly(stay.departureBusinessDate)
      : null,
    checkoutTiming: timing,
    notes: rr.reservation.notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
    assignments: rr.assignments.map((a) => ({
      id: a.id,
      roomNumber: a.room.number,
      from: toDateOnly(a.fromDate),
      to: toDateOnly(a.toDate),
      kind: a.kind,
      status: a.status,
      reason: a.reasonCode,
      assignedAt: a.createdAt.toISOString(),
      assignedBy: names.get(a.assignedById) ?? null,
      releasedAt: a.releasedAt?.toISOString() ?? null,
    })),
    roomStatusChanges: statusChanges.map((c) => ({
      id: c.id,
      roomNumber: c.roomNumber,
      field: c.field,
      from: c.from,
      to: c.to,
      source: c.source,
      at: c.at,
      by: c.changedById ? (names.get(c.changedById) ?? null) : null,
    })),
    history: history.map((h) => ({
      id: h.id,
      at: h.at,
      action: h.action,
      userDisplayName: h.userDisplayName,
      risk: h.risk,
      reason: h.reason,
      before: h.before,
      after: h.after,
    })),
    allowedActions: {
      checkOut:
        inHouse && businessDate !== null && can("frontdesk:checkout") && timing !== "SAME_DAY",
      moveRoom:
        inHouse &&
        businessDate !== null &&
        can("rooms:assign") &&
        departure > (businessDate ?? departure),
    },
    reasonCodes: {
      roomMove: reasons.filter((r) => r.category === "ROOM_MOVE").map(ref),
      earlyDeparture: reasons.filter((r) => r.category === "EARLY_DEPARTURE").map(ref),
    },
  };
}
