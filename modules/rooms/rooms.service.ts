import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import type { PropertyContext } from "@/lib/http/context";
import { AppError, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasPermission } from "@/lib/permissions/evaluate";
import {
  lockInventoryForRelease,
  reserveInventory,
  syncInventoryCounters,
} from "@/modules/availability/availability.service";
import { fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { frontOfficeRules } from "@/modules/properties/properties.service";
import {
  type FrontOfficeStatus,
  type HousekeepingStatus,
  type RoomBoardFilter,
  type RoomStatusSnapshot,
  type RoomStatusSource,
  roomBoardStatus,
  roomReadiness,
} from "./rooms.policy";
import {
  countInHouseStays,
  findBoardReferenceData,
  findOverlappingAssignments,
  findOverlappingBlocks,
  findRoomBoard,
  findRoomDetail,
  findRoomRef,
  findServiceReasonCode,
  findStatusHistory,
  insertServiceBlock,
  insertStatusHistory,
  lockRooms,
  lockServiceBlock,
  releaseBlockRow,
  updateRoomStatusVersioned,
} from "./rooms.repository";
import type { RoomBoardRow, RoomBoardView, RoomDetail } from "./rooms.types";

/**
 * Rooms: locked status changes with history, out-of-order / out-of-service
 * blocks, the room board and room detail. Front office status is never set
 * manually (docs/DOMAIN_MODEL.md §6.2); housekeeping status changes come from
 * the housekeeping and front desk services; service status from blocks.
 * Every change writes room_status_history in the caller's transaction.
 */

export interface LockedRoom extends RoomStatusSnapshot {
  id: string;
  number: string;
  roomTypeId: string;
  active: boolean;
  serviceStatus: string;
  version: number;
}

type Actor = { propertyId: string; userId: string };

/**
 * Locks the rooms FOR UPDATE in id order. Lock order (docs/ARCHITECTURE.md
 * §5): business date → reservation room → stay → inventory → sequence →
 * rooms → housekeeping task. Unknown ids (or rooms of another property)
 * raise NOT_FOUND.
 */
export async function lockRoomsForUpdate(
  tx: Tx,
  propertyId: string,
  businessDate: string,
  ids: string[],
): Promise<Map<string, LockedRoom>> {
  const rows = await lockRooms(tx, propertyId, ids, businessDate);
  const rooms = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        number: row.number,
        roomTypeId: row.room_type_id,
        active: row.status === "ACTIVE",
        housekeepingStatus: row.housekeeping_status as HousekeepingStatus,
        frontOfficeStatus: row.front_office_status as FrontOfficeStatus,
        serviceStatus: row.service_status,
        outOfOrder: row.out_of_order,
        outOfService: row.out_of_service,
        version: row.version,
      },
    ]),
  );
  for (const id of ids) if (!rooms.has(id)) throw notFound("Room");
  return rooms;
}

/** Applies the changed fields to a locked room and records each change in the history. */
export async function changeRoomStatus(
  tx: Tx,
  actor: Actor,
  room: LockedRoom,
  change: {
    frontOfficeStatus?: FrontOfficeStatus;
    housekeepingStatus?: HousekeepingStatus;
    serviceStatus?: "IN_SERVICE" | "OUT_OF_ORDER" | "OUT_OF_SERVICE";
  },
  source: RoomStatusSource,
  businessDate: string,
  reason: string | null = null,
): Promise<LockedRoom> {
  const history: {
    field: "FRONT_OFFICE" | "HOUSEKEEPING" | "SERVICE";
    from: string;
    to: string;
  }[] = [];
  if (change.frontOfficeStatus && change.frontOfficeStatus !== room.frontOfficeStatus)
    history.push({
      field: "FRONT_OFFICE",
      from: room.frontOfficeStatus,
      to: change.frontOfficeStatus,
    });
  if (change.housekeepingStatus && change.housekeepingStatus !== room.housekeepingStatus)
    history.push({
      field: "HOUSEKEEPING",
      from: room.housekeepingStatus,
      to: change.housekeepingStatus,
    });
  if (change.serviceStatus && change.serviceStatus !== room.serviceStatus)
    history.push({ field: "SERVICE", from: room.serviceStatus, to: change.serviceStatus });
  if (history.length === 0) return room;

  const { count } = await updateRoomStatusVersioned(tx, room.id, room.version, {
    ...(change.frontOfficeStatus ? { frontOfficeStatus: change.frontOfficeStatus } : {}),
    ...(change.housekeepingStatus ? { housekeepingStatus: change.housekeepingStatus } : {}),
    ...(change.serviceStatus ? { serviceStatus: change.serviceStatus } : {}),
  });
  if (count !== 1) throw staleVersion("Room");
  await insertStatusHistory(
    tx,
    history.map((h) => ({
      propertyId: actor.propertyId,
      roomId: room.id,
      field: h.field,
      fromValue: h.from,
      toValue: h.to,
      businessDate: fromDateOnly(businessDate),
      source,
      reason: reason ? reason.slice(0, 500) : null,
      changedById: actor.userId,
    })),
  );
  return {
    ...room,
    frontOfficeStatus: change.frontOfficeStatus ?? room.frontOfficeStatus,
    housekeepingStatus: change.housekeepingStatus ?? room.housekeepingStatus,
    serviceStatus: change.serviceStatus ?? room.serviceStatus,
    version: room.version + 1,
  };
}

export interface RoomStatusChangeView {
  id: string;
  roomNumber: string;
  field: string;
  from: string | null;
  to: string | null;
  businessDate: string;
  source: string;
  reason: string | null;
  changedById: string | null;
  at: string;
}

export async function roomStatusHistory(
  tx: Tx,
  propertyId: string,
  roomIds: string[],
  take = 50,
): Promise<RoomStatusChangeView[]> {
  if (roomIds.length === 0) return [];
  const rows = await findStatusHistory(tx, propertyId, roomIds, take);
  return rows.map((row) => ({
    id: row.id,
    roomNumber: row.room.number,
    field: row.field,
    from: row.fromValue,
    to: row.toValue,
    businessDate: toDateOnly(row.businessDate),
    source: row.source,
    reason: row.reason,
    changedById: row.changedById,
    at: row.createdAt.toISOString(),
  }));
}

// --- Service blocks -----------------------------------------------------------------------

export type ServiceBlockKind = "OUT_OF_ORDER" | "OUT_OF_SERVICE";

/**
 * Places a room out of order / out of service for [from, to) inside the
 * caller's transaction (which holds the business-date lock).
 *
 * - Out of order removes the room from inventory: the room type must still
 *   have a free room for every night (inventory cells are locked and
 *   re-counted first), no guest may be in the room, and no reservation may
 *   hold the room for those nights (move them first).
 * - Out of service keeps the room in inventory; assignments are allowed but
 *   check-in / moves into it need an explicit override.
 * - A block covering the business date updates the room's service status.
 */
export async function placeServiceBlock(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  input: {
    roomId: string;
    kind: ServiceBlockKind;
    from: string;
    to: string;
    reasonCodeId: string;
    notes?: string | null;
    maintenanceRequestId?: string | null;
    reason?: string | null;
  },
): Promise<{ blockId: string; roomNumber: string; room: LockedRoom }> {
  if (input.from < businessDate) {
    throw new AppError("VALIDATION_FAILED", "The block cannot start before the business date", {
      fields: { from: [`On or after ${businessDate}`] },
    });
  }
  if (input.to <= input.from) {
    throw new AppError("VALIDATION_FAILED", "The return date must be after the start date", {
      fields: { to: ["After the start date"] },
    });
  }
  const ref = await findRoomRef(tx, ctx.propertyId, input.roomId);
  if (!ref || ref.status !== "ACTIVE") throw notFound("Room");
  const reasonCode = await findServiceReasonCode(
    tx,
    ctx.propertyId,
    input.reasonCodeId,
    input.kind,
  );
  if (!reasonCode) {
    throw new AppError("VALIDATION_FAILED", "Choose a valid reason code", {
      fields: { reasonCodeId: ["Invalid reason"] },
    });
  }
  const from = fromDateOnly(input.from);
  const to = fromDateOnly(input.to);
  const demand = { roomTypeId: ref.roomTypeId, arrival: input.from, departure: input.to, rooms: 1 };

  if (input.kind === "OUT_OF_ORDER") {
    // Lock and re-count the room type's nights: taking a room out must not oversell.
    await reserveInventory(tx, ctx.propertyId, [demand], { allowOverbooking: false }).catch(
      (error: unknown) => {
        if (error instanceof AppError && error.details?.reason === "NO_AVAILABILITY") {
          throw new AppError(
            "BUSINESS_RULE_VIOLATION",
            `Taking room ${ref.number} out of order would oversell its room type on some nights`,
            { reason: "BLOCK_OVERSELLS", nights: error.details.nights },
          );
        }
        throw error;
      },
    );
  }

  const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [input.roomId]);
  let room = rooms.get(input.roomId)!;
  const overlapping = await findOverlappingBlocks(tx, room.id, from, to);
  if (overlapping.length > 0) {
    throw new AppError(
      "CONFLICT",
      `Room ${room.number} is already blocked for some of these nights`,
      {
        reason: "BLOCK_OVERLAPS",
      },
    );
  }
  if (input.kind === "OUT_OF_ORDER") {
    if (input.from === businessDate && (await countInHouseStays(tx, ctx.propertyId, room.id)) > 0) {
      throw new AppError("CONFLICT", `A guest is in room ${room.number}; move the guest first`, {
        reason: "ROOM_OCCUPIED",
      });
    }
    const assigned = await findOverlappingAssignments(tx, room.id, from, to);
    if (assigned.length > 0) {
      throw new AppError(
        "CONFLICT",
        `Room ${room.number} is assigned to reservations for these nights; reassign them first`,
        {
          reason: "ROOM_ASSIGNED",
          reservations: assigned.map((a) => ({
            confirmation: a.reservationRoom.reservation.confirmationNumber,
            from: toDateOnly(a.fromDate),
            to: toDateOnly(a.toDate),
          })),
        },
      );
    }
  }

  const coversToday = input.from <= businessDate;
  const block = await insertServiceBlock(tx, {
    propertyId: ctx.propertyId,
    roomId: room.id,
    kind: input.kind,
    status: coversToday ? "ACTIVE" : "SCHEDULED",
    fromDate: from,
    toDate: to,
    reasonCodeId: reasonCode.id,
    returnStatus: "DIRTY",
    notes: input.notes ?? null,
    maintenanceRequestId: input.maintenanceRequestId ?? null,
    createdById: ctx.userId,
  });
  if (coversToday) {
    room = await changeRoomStatus(
      tx,
      { propertyId: ctx.propertyId, userId: ctx.userId },
      room,
      { serviceStatus: input.kind },
      input.maintenanceRequestId ? "MAINTENANCE" : "USER",
      businessDate,
      input.reason ?? reasonCode.name,
    );
  }
  if (input.kind === "OUT_OF_ORDER") await syncInventoryCounters(tx, ctx.propertyId, [demand]);
  return { blockId: block.id, roomNumber: room.number, room };
}

/**
 * Returns a blocked room to service inside the caller's transaction. A block
 * that had started puts the room back as vacant/dirty (its return status):
 * it must be cleaned (and inspected where required) before it is ready.
 * A second concurrent release finds the block already released → 409.
 */
export async function releaseServiceBlock(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  blockId: string,
  reason: string | null,
): Promise<{
  roomId: string;
  roomNumber: string;
  kind: ServiceBlockKind;
  started: boolean;
  maintenanceRequestId: string | null;
}> {
  const block = await lockServiceBlock(tx, ctx.propertyId, blockId);
  if (!block) throw notFound("Room block");
  if (block.status !== "SCHEDULED" && block.status !== "ACTIVE") {
    throw new AppError("CONFLICT", "The room has already been returned to service", {
      reason: "BLOCK_RELEASED",
    });
  }
  const ref = await findRoomRef(tx, ctx.propertyId, block.room_id);
  if (!ref) throw notFound("Room");
  const from = toDateOnly(block.from_date);
  const to = toDateOnly(block.to_date);
  const remaining = {
    roomTypeId: ref.roomTypeId,
    arrival: from > businessDate ? from : businessDate,
    departure: to,
    rooms: 1,
  };
  const affectsInventory = block.kind === "OUT_OF_ORDER" && remaining.departure > remaining.arrival;
  if (affectsInventory) await lockInventoryForRelease(tx, ctx.propertyId, [remaining]);

  const rooms = await lockRoomsForUpdate(tx, ctx.propertyId, businessDate, [block.room_id]);
  const room = rooms.get(block.room_id)!;
  await releaseBlockRow(tx, block.id, ctx.userId);
  const started = from <= businessDate;
  if (started) {
    await changeRoomStatus(
      tx,
      { propertyId: ctx.propertyId, userId: ctx.userId },
      room,
      {
        serviceStatus: "IN_SERVICE",
        housekeepingStatus: block.return_status as HousekeepingStatus,
      },
      block.maintenance_request_id ? "MAINTENANCE" : "USER",
      businessDate,
      reason,
    );
  }
  if (affectsInventory) await syncInventoryCounters(tx, ctx.propertyId, [remaining]);
  return {
    roomId: room.id,
    roomNumber: room.number,
    kind: block.kind,
    started,
    maintenanceRequestId: block.maintenance_request_id,
  };
}

// --- Queries ----------------------------------------------------------------------------------

function requireBusinessDate(ctx: PropertyContext): string {
  if (!ctx.businessDate) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The property business date has not been initialized",
    );
  }
  return ctx.businessDate;
}

const MAINTENANCE_RANKS = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;

/**
 * The room board shared by the front desk and housekeeping. Guest names are
 * included only for users who may see front desk data (`frontdesk:read`);
 * everyone else sees occupancy and arrival/departure flags only.
 */
export async function listRoomBoard(
  ctx: PropertyContext,
  query: { filter: RoomBoardFilter; roomTypeId?: string; floorId?: string },
): Promise<RoomBoardView> {
  const businessDate = requireBusinessDate(ctx);
  const can = (permission: Permission) => hasPermission(ctx.access, ctx.propertyId, permission);
  const showGuests = can("frontdesk:read");
  const rules = await frontOfficeRules(prisma, ctx.propertyId);
  const rows = await findRoomBoard(prisma, ctx.propertyId, businessDate, {
    roomTypeId: query.roomTypeId ?? null,
    floorId: query.floorId ?? null,
  });
  const all = rows.map((row): RoomBoardRow => {
    const snapshot: RoomStatusSnapshot = {
      housekeepingStatus: row.housekeeping_status as HousekeepingStatus,
      frontOfficeStatus: row.front_office_status as FrontOfficeStatus,
      outOfOrder: row.block_kind === "OUT_OF_ORDER",
      outOfService: row.block_kind === "OUT_OF_SERVICE",
    };
    const departingToday =
      row.stay_departure !== null && toDateOnly(row.stay_departure) <= businessDate;
    const arrivingToday = row.arriving_reservation_room_id !== null;
    const readiness = roomReadiness(snapshot, rules.requireInspectedForCheckIn);
    return {
      id: row.id,
      number: row.number,
      version: row.version,
      floor: row.floor_id && row.floor ? { id: row.floor_id, name: row.floor } : null,
      roomType: { id: row.room_type_id, code: row.room_type_code },
      housekeepingStatus: row.housekeeping_status,
      frontOfficeStatus: row.front_office_status,
      block:
        row.block_id && row.block_kind && row.block_until
          ? {
              id: row.block_id,
              kind: row.block_kind,
              until: toDateOnly(row.block_until),
              reason: row.block_reason,
            }
          : null,
      status: roomBoardStatus(snapshot, rules.requireInspectedForCheckIn),
      readiness,
      inHouse: row.stay_id
        ? {
            stayId: showGuests ? row.stay_id : null,
            guestName: showGuests ? row.stay_guest : null,
            vip: showGuests ? row.stay_vip : null,
            departure: row.stay_departure ? toDateOnly(row.stay_departure) : null,
            departingToday,
          }
        : null,
      arriving: arrivingToday
        ? {
            reservationId: showGuests ? row.arriving_reservation_id : null,
            reservationRoomId: showGuests ? row.arriving_reservation_room_id : null,
            guestName: showGuests ? row.arriving_guest : null,
            vip: showGuests ? row.arriving_vip : null,
            eta: row.arriving_eta,
          }
        : null,
      task: row.task_id
        ? {
            id: row.task_id,
            status: row.task_status!,
            priority: row.task_priority ?? 100,
            typeCode: row.task_type_code ?? "",
            attendant: row.task_attendant,
          }
        : null,
      maintenance:
        row.open_maintenance > 0
          ? {
              open: row.open_maintenance,
              topPriority: MAINTENANCE_RANKS[row.maintenance_rank ?? 3] ?? "LOW",
            }
          : null,
      // Housekeeping urgency: a vacant room that is not ready while a guest
      // arrives today comes first; then open maintenance / departures.
      urgency:
        arrivingToday && readiness !== "READY" && snapshot.frontOfficeStatus === "VACANT"
          ? "URGENT"
          : arrivingToday || departingToday || (row.task_priority ?? 100) < 100
            ? "PRIORITY"
            : "NORMAL",
    };
  });

  const matches: Record<RoomBoardFilter, (r: RoomBoardRow) => boolean> = {
    all: () => true,
    vacant_ready: (r) => r.status === "VACANT_READY",
    vacant_not_ready: (r) => r.status === "VACANT_NOT_READY",
    occupied: (r) => r.frontOfficeStatus === "OCCUPIED",
    vacant: (r) => r.frontOfficeStatus === "VACANT",
    out_of_order: (r) => r.block?.kind === "OUT_OF_ORDER",
    out_of_service: (r) => r.block?.kind === "OUT_OF_SERVICE",
    arriving: (r) => r.arriving !== null,
    departing: (r) => r.inHouse?.departingToday === true,
    dirty: (r) => r.housekeepingStatus === "DIRTY" || r.housekeepingStatus === "PICKUP",
    clean: (r) => r.housekeepingStatus === "CLEAN",
    inspected: (r) => r.housekeepingStatus === "INSPECTED",
    maintenance: (r) => r.maintenance !== null,
  };
  const counts = {
    total: all.length,
    OUT_OF_ORDER: 0,
    OUT_OF_SERVICE: 0,
    OCCUPIED: 0,
    VACANT_READY: 0,
    VACANT_NOT_READY: 0,
    dirty: 0,
    clean: 0,
    inspected: 0,
    urgent: 0,
    maintenance: 0,
  };
  for (const r of all) {
    counts[r.status] += 1;
    if (matches.dirty(r)) counts.dirty += 1;
    if (matches.clean(r)) counts.clean += 1;
    if (matches.inspected(r)) counts.inspected += 1;
    if (r.urgency === "URGENT") counts.urgent += 1;
    if (r.maintenance) counts.maintenance += 1;
  }
  const rank = { URGENT: 0, PRIORITY: 1, NORMAL: 2 } as const;
  const items = all
    .filter(matches[query.filter])
    .map((r, index) => ({ r, index }))
    .sort((a, b) => rank[a.r.urgency] - rank[b.r.urgency] || a.index - b.index)
    .map(({ r }) => r);
  return { businessDate, counts, items };
}

export async function boardReferenceData(ctx: PropertyContext) {
  const [floors, roomTypes] = await findBoardReferenceData(prisma, ctx.propertyId);
  return { floors, roomTypes };
}

/** Room detail: statuses, live service blocks and recent status history. */
export async function getRoom(ctx: PropertyContext, roomId: string): Promise<RoomDetail> {
  const businessDate = requireBusinessDate(ctx);
  const room = await findRoomDetail(prisma, ctx.propertyId, roomId);
  if (!room) throw notFound("Room");
  const rules = await frontOfficeRules(prisma, ctx.propertyId);
  const covering = room.roomServiceBlocks.find(
    (b) => toDateOnly(b.fromDate) <= businessDate && toDateOnly(b.toDate) > businessDate,
  );
  const snapshot: RoomStatusSnapshot = {
    housekeepingStatus: room.housekeepingStatus,
    frontOfficeStatus: room.frontOfficeStatus,
    outOfOrder: covering?.kind === "OUT_OF_ORDER",
    outOfService: covering?.kind === "OUT_OF_SERVICE",
  };
  const history = await roomStatusHistory(prisma, ctx.propertyId, [room.id], 30);
  return {
    id: room.id,
    number: room.number,
    version: room.version,
    description: room.description,
    active: room.status === "ACTIVE",
    roomType: room.roomType,
    floor: room.floor,
    housekeepingStatus: room.housekeepingStatus,
    frontOfficeStatus: room.frontOfficeStatus,
    serviceStatus: room.serviceStatus,
    readiness: roomReadiness(snapshot, rules.requireInspectedForCheckIn),
    requireInspected: rules.requireInspectedForCheckIn,
    isAccessible: room.isAccessible,
    isSmoking: room.isSmoking,
    blocks: room.roomServiceBlocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      status: b.status,
      from: toDateOnly(b.fromDate),
      to: toDateOnly(b.toDate),
      notes: b.notes,
      reason: b.reasonCode,
      maintenanceRequestId: b.maintenanceRequestId,
      coversBusinessDate: b.id === covering?.id,
    })),
    history,
  };
}

// --- Night audit (Phase 8) ------------------------------------------------------------------

/**
 * Night audit's service-block roll into `nextDate` (D+1), inside the audit
 * transaction. Blocks whose period ends by `nextDate` are released (a room
 * that was out returns to service with its return status); scheduled
 * blocks that start by `nextDate` become ACTIVE and take the room out.
 * Inventory is unchanged: out-of-order nights are counted from the block
 * dates (scheduled or active), not from the status.
 */
export async function rollServiceBlocksInTx(
  tx: Tx,
  actor: { propertyId: string; userId: string },
  businessDate: string,
  nextDate: string,
): Promise<{
  released: { roomNumber: string; kind: string }[];
  activated: { roomNumber: string; kind: string }[];
}> {
  const due = await tx.$queryRaw<
    {
      id: string;
      room_id: string;
      kind: string;
      status: string;
      from_date: Date;
      to_date: Date;
      return_status: string;
    }[]
  >`
    SELECT "id", "room_id", "kind"::text AS "kind", "status"::text AS "status", "from_date",
           "to_date", "return_status"::text AS "return_status"
    FROM "room_service_blocks"
    WHERE "property_id" = ${actor.propertyId}::uuid
      AND "status" IN ('SCHEDULED', 'ACTIVE')
      AND ("to_date" <= ${nextDate}::date OR ("status" = 'SCHEDULED' AND "from_date" <= ${nextDate}::date))
    ORDER BY "id"
    FOR UPDATE`;
  const released: { roomNumber: string; kind: string }[] = [];
  const activated: { roomNumber: string; kind: string }[] = [];
  if (due.length === 0) return { released, activated };
  const rooms = await lockRoomsForUpdate(
    tx,
    actor.propertyId,
    businessDate,
    due.map((block) => block.room_id),
  );
  for (const block of due) {
    let room = rooms.get(block.room_id)!;
    if (toDateOnly(block.to_date) <= nextDate) {
      await releaseBlockRow(tx, block.id, actor.userId);
      if (block.status === "ACTIVE") {
        room = await changeRoomStatus(
          tx,
          actor,
          room,
          {
            serviceStatus: "IN_SERVICE",
            housekeepingStatus: block.return_status as HousekeepingStatus,
          },
          "NIGHT_AUDIT",
          businessDate,
          "Block period ended",
        );
      }
      released.push({ roomNumber: room.number, kind: block.kind });
    } else {
      await tx.roomServiceBlock.update({ where: { id: block.id }, data: { status: "ACTIVE" } });
      room = await changeRoomStatus(
        tx,
        actor,
        room,
        { serviceStatus: block.kind as "OUT_OF_ORDER" | "OUT_OF_SERVICE" },
        "NIGHT_AUDIT",
        businessDate,
        "Block period started",
      );
      activated.push({ roomNumber: room.number, kind: block.kind });
    }
    rooms.set(room.id, room);
  }
  return { released, activated };
}

/**
 * Night audit's room-status roll (DOMAIN_MODEL §6.2, D8): every occupied
 * room was slept in, so its housekeeping status becomes DIRTY. Only the
 * housekeeping axis changes; history source NIGHT_AUDIT.
 */
export async function rollOccupiedRoomsInTx(
  tx: Tx,
  actor: { propertyId: string; userId: string },
  businessDate: string,
): Promise<string[]> {
  const ids = (
    await tx.room.findMany({
      where: {
        propertyId: actor.propertyId,
        frontOfficeStatus: "OCCUPIED",
        housekeepingStatus: { not: "DIRTY" },
      },
      select: { id: true },
    })
  ).map((room) => room.id);
  if (ids.length === 0) return [];
  const rooms = await lockRoomsForUpdate(tx, actor.propertyId, businessDate, ids);
  const rolled: string[] = [];
  for (const room of rooms.values()) {
    if (room.frontOfficeStatus !== "OCCUPIED" || room.housekeepingStatus === "DIRTY") continue;
    await changeRoomStatus(
      tx,
      actor,
      room,
      { housekeepingStatus: "DIRTY" },
      "NIGHT_AUDIT",
      businessDate,
      "Occupied overnight",
    );
    rolled.push(room.number);
  }
  return rolled;
}
