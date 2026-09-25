import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import type { PropertyContext } from "@/lib/http/context";
import { AppError } from "@/lib/http/errors";
import { toDateOnly } from "@/modules/business-date/business-date.policy";
import { findBookableAccount } from "@/modules/accounts/accounts.repository";
import { loadRates, quoteRoomType, type StayRequest } from "@/modules/rates/rates.service";
import { occupancyProblems, stayNights } from "@/modules/reservations/reservations.policy";
import {
  type NightInventory,
  type RestrictionRow,
  availableForNight,
  restrictionViolations,
  roomTypeStatus,
  stayAvailability,
} from "./availability.policy";
import {
  countBlockedNights,
  countCommittedNights,
  countOutOfOrder,
  findBlockNights,
  lockAllocationCells,
  lockBlockForShare,
  syncAllocationPickup,
  countPhysicalRooms,
  findInventoryControls,
  findRestrictions,
  findSellableRoomTypes,
  lockInventoryCells,
  writeInventoryCounters,
} from "./availability.repository";
import type { AvailabilityQuery } from "./availability.schema";
import type { AvailabilityView, RoomTypeAvailabilityView } from "./availability.types";

/** The property must be live, and stays cannot start before its business date. */
export function requireBookableArrival(ctx: PropertyContext, arrival: string): string {
  if (!ctx.businessDate) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "This property is not live yet (no business date)",
      {
        reason: "PROPERTY_NOT_LIVE",
      },
    );
  }
  if (arrival < ctx.businessDate) {
    throw new AppError("VALIDATION_FAILED", "Arrival cannot be before the hotel business date", {
      fields: { arrival: [`Arrival must be on or after ${ctx.businessDate}`] },
      businessDate: ctx.businessDate,
    });
  }
  return ctx.businessDate;
}

/**
 * Per-night inventory for room types over [arrival, departure), aggregated in
 * PostgreSQL. `excludeReservationRoomIds` removes a reservation's own nights
 * (used when re-validating a modification).
 */
export async function loadNightInventory(
  db: Tx,
  propertyId: string,
  roomTypeIds: string[],
  arrival: string,
  departure: string,
  excludeReservationRoomIds: string[] = [],
  excludeBlockId: string | null = null,
): Promise<Map<string, NightInventory[]>> {
  // Sequential on purpose: this also runs inside interactive transactions,
  // which execute one statement at a time on a single connection.
  const physical = await countPhysicalRooms(db, propertyId, roomTypeIds);
  const outOfOrder = await countOutOfOrder(db, propertyId, roomTypeIds, arrival, departure);
  const committed = await countCommittedNights(
    db,
    propertyId,
    roomTypeIds,
    arrival,
    departure,
    excludeReservationRoomIds,
  );
  const blocked = await countBlockedNights(db, propertyId, roomTypeIds, arrival, departure, {
    excludeReservationRoomIds,
    excludeBlockId,
  });
  const controls = await findInventoryControls(db, propertyId, roomTypeIds, arrival, departure);
  const key = (roomTypeId: string, date: Date) => `${roomTypeId}|${toDateOnly(date)}`;
  const blockedMap = new Map(blocked.map((r) => [key(r.room_type_id, r.stay_date), r.blocked]));
  const oooMap = new Map(outOfOrder.map((r) => [key(r.room_type_id, r.stay_date), r.rooms]));
  const committedMap = new Map(committed.map((r) => [key(r.room_type_id, r.stay_date), r]));
  const controlMap = new Map(controls.map((r) => [key(r.room_type_id, r.stay_date), r]));
  const nights = stayNights(arrival, departure);

  return new Map(
    roomTypeIds.map((roomTypeId) => [
      roomTypeId,
      nights.map((date) => {
        const k = `${roomTypeId}|${date}`;
        const control = controlMap.get(k);
        return {
          date,
          physical: physical.get(roomTypeId) ?? 0,
          outOfOrder: oooMap.get(k) ?? 0,
          sold: committedMap.get(k)?.sold ?? 0,
          tentative: committedMap.get(k)?.tentative ?? 0,
          // Held by deducting group blocks, counted from the source rows (Phase 6).
          blocked: blockedMap.get(k) ?? 0,
          overbookLimit: control?.overbook_limit ?? 0,
          sellLimit: control?.sell_limit ?? null,
        };
      }),
    ]),
  );
}

/** "What can we sell for this request?" — room types with counts, status and rate quotes. */
export async function searchAvailability(
  ctx: PropertyContext,
  query: AvailabilityQuery,
): Promise<AvailabilityView> {
  const businessDate = requireBookableArrival(ctx, query.arrival);
  const nights = stayNights(query.arrival, query.departure);
  const roomTypes = await findSellableRoomTypes(
    prisma,
    ctx.propertyId,
    query.roomTypeId ? [query.roomTypeId] : undefined,
  );
  if (query.roomTypeId && roomTypes.length === 0) {
    throw new AppError("NOT_FOUND", "Room type not found");
  }
  const roomTypeIds = roomTypes.map((rt) => rt.id);
  if (
    query.companyId &&
    !(await findBookableAccount(prisma, ctx.organizationId, query.companyId))
  ) {
    throw new AppError("NOT_FOUND", "Company not found");
  }
  const stay: StayRequest = {
    propertyId: ctx.propertyId,
    businessDate,
    arrival: query.arrival,
    departure: query.departure,
    nights,
    adults: query.adults,
    children: query.children,
    accountId: query.companyId ?? null,
  };

  const [inventory, restrictionRows, rates] = await Promise.all([
    loadNightInventory(prisma, ctx.propertyId, roomTypeIds, query.arrival, query.departure),
    loadRestrictions(prisma, ctx.propertyId, query.arrival, query.departure),
    loadRates(prisma, stay, ctx.currencyCode),
  ]);
  if (query.ratePlanId && !rates.plans.some((plan) => plan.id === query.ratePlanId)) {
    throw new AppError("NOT_FOUND", "Rate plan not found");
  }

  const results: RoomTypeAvailabilityView[] = roomTypes.map((roomType) => {
    const nightRows = inventory.get(roomType.id) ?? [];
    const problems = occupancyProblems(roomType, query.adults, query.children);
    const typeViolations = restrictionViolations({
      rows: restrictionRows.filter((r) => r.ratePlanId === null),
      roomTypeId: roomType.id,
      ratePlanId: null,
      arrival: query.arrival,
      departure: query.departure,
      nights,
      businessDate,
    });
    const available = stayAvailability(nightRows);
    const rateQuotes =
      problems.length > 0
        ? []
        : quoteRoomType(rates, stay, roomType.id, restrictionRows, query.ratePlanId);
    return {
      roomType: {
        id: roomType.id,
        code: roomType.code,
        name: roomType.name,
        maxOccupancy: roomType.maxOccupancy,
        maxAdults: roomType.maxAdults,
        maxChildren: roomType.maxChildren,
      },
      status: roomTypeStatus({
        available,
        requestedRooms: query.rooms,
        occupancyFits: problems.length === 0,
        closed: typeViolations.length > 0,
      }),
      occupancyProblems: problems,
      physical: Math.min(...nightRows.map((n) => n.physical)),
      reserved: Math.max(...nightRows.map((n) => n.sold)),
      tentative: Math.max(...nightRows.map((n) => n.tentative)),
      outOfOrder: Math.max(...nightRows.map((n) => n.outOfOrder)),
      available: Math.max(0, available),
      requestedRooms: query.rooms,
      restrictions: typeViolations,
      nights: nightRows.map((n) => ({
        date: n.date,
        physical: n.physical,
        outOfOrder: n.outOfOrder,
        sold: n.sold,
        tentative: n.tentative,
        available: Math.max(0, availableForNight(n)),
      })),
      rates: rateQuotes,
    };
  });

  return {
    propertyId: ctx.propertyId,
    arrival: query.arrival,
    departure: query.departure,
    nights: nights.length,
    adults: query.adults,
    children: query.children,
    rooms: query.rooms,
    businessDate,
    roomTypes: results,
  };
}

export async function loadRestrictions(
  db: Tx,
  propertyId: string,
  arrival: string,
  departure: string,
) {
  const rows = await findRestrictions(db, propertyId, arrival, departure);
  return rows.map((r): RestrictionRow => ({
    stayDate: toDateOnly(r.stayDate),
    type: r.type,
    roomTypeId: r.roomTypeId,
    ratePlanId: r.ratePlanId,
    value: r.value,
  }));
}

export interface InventoryDemand {
  roomTypeId: string;
  arrival: string;
  departure: string;
  rooms: number;
}

/**
 * Inventory guard for selling rooms (docs/ARCHITECTURE.md §5). Locks the
 * counter rows of every demanded (room type, night) in a fixed order, then
 * recounts from the source rows — so a concurrent booking that committed a
 * moment earlier is always seen. Throws when a night lacks capacity unless
 * `allowOverbooking` (a separately authorized, audited override).
 * Must run inside the caller's transaction, before its nights are written.
 */
export async function reserveInventory(
  tx: Tx,
  propertyId: string,
  demands: readonly InventoryDemand[],
  options: { allowOverbooking: boolean; excludeReservationRoomIds?: string[] },
): Promise<void> {
  const cells = demandCells(demands);
  await lockInventoryCells(tx, propertyId, cells);
  await lockAllocationCells(tx, propertyId, cells);
  for (const demand of demands) {
    const inventory = await loadNightInventory(
      tx,
      propertyId,
      [demand.roomTypeId],
      demand.arrival,
      demand.departure,
      options.excludeReservationRoomIds,
    );
    const nights = inventory.get(demand.roomTypeId) ?? [];
    const short = nights.filter((night) => availableForNight(night) < demand.rooms);
    if (short.length > 0 && !options.allowOverbooking) {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "Not enough rooms are available for the selected dates",
        {
          reason: "NO_AVAILABILITY",
          roomTypeId: demand.roomTypeId,
          requested: demand.rooms,
          nights: short.map((night) => ({
            date: night.date,
            available: Math.max(0, availableForNight(night)),
          })),
        },
      );
    }
  }
}

/** Locks cells released by a cancellation / no-show so counters can be refreshed consistently. */
export async function lockInventoryForRelease(
  tx: Tx,
  propertyId: string,
  demands: readonly InventoryDemand[],
) {
  const cells = demandCells(demands);
  await lockInventoryCells(tx, propertyId, cells);
  await lockAllocationCells(tx, propertyId, cells);
}

/**
 * Rewrites the cached counters (physical, out-of-order, sold) of the given
 * cells from the source rows, after the caller changed its nights. The rows
 * are already locked by reserveInventory / lockInventoryForRelease.
 */
export async function syncInventoryCounters(
  tx: Tx,
  propertyId: string,
  demands: readonly InventoryDemand[],
) {
  const byType = new Map<string, { from: string; to: string }>();
  for (const d of demands) {
    const range = byType.get(d.roomTypeId);
    byType.set(d.roomTypeId, {
      from: range && range.from < d.arrival ? range.from : d.arrival,
      to: range && range.to > d.departure ? range.to : d.departure,
    });
  }
  const wanted = new Set(demandCells(demands).map((c) => `${c.roomTypeId}|${c.stayDate}`));
  const rows: {
    roomTypeId: string;
    stayDate: string;
    physical: number;
    outOfOrder: number;
    sold: number;
    blocked: number;
  }[] = [];
  for (const [roomTypeId, range] of byType) {
    const inventory = await loadNightInventory(tx, propertyId, [roomTypeId], range.from, range.to);
    for (const night of inventory.get(roomTypeId) ?? []) {
      if (!wanted.has(`${roomTypeId}|${night.date}`)) continue;
      rows.push({
        roomTypeId,
        stayDate: night.date,
        physical: night.physical,
        outOfOrder: night.outOfOrder,
        sold: night.sold,
        blocked: night.blocked,
      });
    }
  }
  await writeInventoryCounters(tx, propertyId, rows);
  // Block pickup caches of the same cells (rows locked with the cells).
  await syncAllocationPickup(tx, propertyId, demandCells(demands));
}

/**
 * Inventory guard for a group-block pickup (docs/PMS_WORKFLOWS.md §18). Takes
 * the block FOR SHARE (serializing with block status changes and releases),
 * locks the inventory cells and then the allocation rows of the stay, and
 * re-counts pickup from the source rows. Each night needs the rooms from
 * what the block still holds; an elastic block may take the excess from
 * house availability. Within the allocation, a pickup moves a room from
 * `blocked` to `sold`, so house availability does not change.
 */
export async function reserveBlockInventory(
  tx: Tx,
  propertyId: string,
  blockId: string,
  demand: InventoryDemand,
  options: { allowOverbooking: boolean; excludeReservationRoomIds?: string[] },
): Promise<void> {
  const block = await lockBlockForShare(tx, propertyId, blockId);
  if (!block) throw new AppError("NOT_FOUND", "Block not found");
  if (block.status_type !== "DEDUCT") {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Rooms can be picked up only from a definite block",
      {
        reason: "BLOCK_NOT_DEFINITE",
      },
    );
  }
  const cells = demandCells([demand]);
  await lockInventoryCells(tx, propertyId, cells);
  await lockAllocationCells(tx, propertyId, cells);

  const excluded = options.excludeReservationRoomIds ?? [];
  const held = await findBlockNights(
    tx,
    blockId,
    demand.roomTypeId,
    demand.arrival,
    demand.departure,
    excluded,
  );
  const heldByDate = new Map(held.map((row) => [toDateOnly(row.stay_date), row]));
  const house =
    (
      await loadNightInventory(
        tx,
        propertyId,
        [demand.roomTypeId],
        demand.arrival,
        demand.departure,
        excluded,
      )
    ).get(demand.roomTypeId) ?? [];
  const short = [];
  for (const night of house) {
    const row = heldByDate.get(night.date);
    if (!row) {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        `The block holds no rooms of this type on ${night.date}`,
        { reason: "NOT_IN_BLOCK", date: night.date },
      );
    }
    const remaining = Math.max(0, row.allocated - row.released - row.picked);
    const fromHouse = block.is_elastic ? Math.max(0, availableForNight(night)) : 0;
    if (remaining + fromHouse < demand.rooms) {
      short.push({ date: night.date, remaining, available: remaining + fromHouse });
    }
  }
  if (short.length > 0 && !options.allowOverbooking) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The block does not hold enough rooms for the selected dates",
      { reason: "BLOCK_EXHAUSTED", requested: demand.rooms, nights: short },
    );
  }
}

function demandCells(demands: readonly InventoryDemand[]) {
  const seen = new Set<string>();
  const cells: { roomTypeId: string; stayDate: string }[] = [];
  for (const demand of demands) {
    for (const stayDate of stayNights(demand.arrival, demand.departure)) {
      const k = `${demand.roomTypeId}|${stayDate}`;
      if (!seen.has(k)) {
        seen.add(k);
        cells.push({ roomTypeId: demand.roomTypeId, stayDate });
      }
    }
  }
  return cells;
}
