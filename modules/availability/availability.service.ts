import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import type { PropertyContext } from "@/lib/http/context";
import { AppError } from "@/lib/http/errors";
import { toDateOnly } from "@/modules/business-date/business-date.policy";
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
  countCommittedNights,
  countOutOfOrder,
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
  const controls = await findInventoryControls(db, propertyId, roomTypeIds, arrival, departure);
  const key = (roomTypeId: string, date: Date) => `${roomTypeId}|${toDateOnly(date)}`;
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
          blocked: control?.blocked ?? 0,
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
  const stay: StayRequest = {
    propertyId: ctx.propertyId,
    businessDate,
    arrival: query.arrival,
    departure: query.departure,
    nights,
    adults: query.adults,
    children: query.children,
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
  await lockInventoryCells(tx, propertyId, demandCells(demands));
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
      });
    }
  }
  await writeInventoryCounters(tx, propertyId, rows);
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
