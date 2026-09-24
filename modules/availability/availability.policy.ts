/**
 * Pure availability rules (isomorphic, unit-tested). See
 * docs/DOMAIN_MODEL.md §5.3:
 *   available = physical − out_of_order − sold − blocked + overbook_limit,
 *   additionally capped by the sell limit (sold may not exceed it).
 * Out-of-service rooms stay sellable; tentative (non-deducting) bookings are
 * reported but do not reduce availability.
 */
import { daysBetween } from "@/modules/business-date/business-date.policy";

export interface NightInventory {
  date: string;
  physical: number;
  outOfOrder: number;
  /** Rooms sold by inventory-deducting reservations. */
  sold: number;
  /** Rooms held by non-deducting (tentative) reservations — informational. */
  tentative: number;
  /** Unpicked-up allocation of deducting blocks (groups, later phase). */
  blocked: number;
  overbookLimit: number;
  sellLimit: number | null;
}

export function availableForNight(night: NightInventory): number {
  const byCapacity =
    night.physical - night.outOfOrder - night.sold - night.blocked + night.overbookLimit;
  const bySellLimit =
    night.sellLimit === null ? Number.POSITIVE_INFINITY : night.sellLimit - night.sold;
  return Math.min(byCapacity, bySellLimit);
}

export type RoomTypeAvailabilityStatus =
  "AVAILABLE" | "LIMITED" | "SOLD_OUT" | "CLOSED" | "NOT_SUITABLE";

/** Bookable rooms for the whole stay = the tightest night. */
export function stayAvailability(nights: readonly NightInventory[]): number {
  if (nights.length === 0) return 0;
  return Math.min(...nights.map(availableForNight));
}

export function roomTypeStatus(options: {
  available: number;
  requestedRooms: number;
  occupancyFits: boolean;
  closed: boolean;
}): RoomTypeAvailabilityStatus {
  if (!options.occupancyFits) return "NOT_SUITABLE";
  if (options.closed) return "CLOSED";
  if (options.available <= 0) return "SOLD_OUT";
  return options.available >= options.requestedRooms ? "AVAILABLE" : "LIMITED";
}

// --- Restrictions ---------------------------------------------------------

export type RestrictionType =
  | "CLOSED"
  | "CLOSED_TO_ARRIVAL"
  | "CLOSED_TO_DEPARTURE"
  | "MIN_LOS"
  | "MAX_LOS"
  | "MIN_STAY_THROUGH"
  | "MAX_STAY_THROUGH"
  | "MIN_ADVANCE_DAYS"
  | "MAX_ADVANCE_DAYS";

export interface RestrictionRow {
  stayDate: string;
  type: RestrictionType;
  roomTypeId: string | null;
  ratePlanId: string | null;
  value: number | null;
}

export interface RestrictionViolation {
  type: RestrictionType;
  date: string;
  value: number | null;
}

/**
 * Restrictions that block a stay for a room type and (optionally) a rate
 * plan. A row applies when its room type / rate plan is null (house-wide) or
 * matches. Arrival-based rules are read on the arrival date, CTD on the
 * departure date, CLOSED and stay-through on every night.
 */
export function restrictionViolations(input: {
  rows: readonly RestrictionRow[];
  roomTypeId: string;
  ratePlanId: string | null;
  arrival: string;
  departure: string;
  nights: readonly string[];
  businessDate: string;
}): RestrictionViolation[] {
  const { rows, roomTypeId, ratePlanId, arrival, departure, nights, businessDate } = input;
  const nightSet = new Set(nights);
  const lengthOfStay = nights.length;
  const advanceDays = daysBetween(businessDate, arrival);
  const violations: RestrictionViolation[] = [];

  for (const row of rows) {
    if (row.roomTypeId !== null && row.roomTypeId !== roomTypeId) continue;
    // Rate-plan rules apply only when evaluating that plan.
    if (row.ratePlanId !== null && row.ratePlanId !== ratePlanId) continue;
    const value = row.value ?? 0;
    const onArrival = row.stayDate === arrival;
    const onStayNight = nightSet.has(row.stayDate);
    let violated = false;
    switch (row.type) {
      case "CLOSED":
        violated = onStayNight;
        break;
      case "CLOSED_TO_ARRIVAL":
        violated = onArrival;
        break;
      case "CLOSED_TO_DEPARTURE":
        violated = row.stayDate === departure;
        break;
      case "MIN_LOS":
        violated = onArrival && lengthOfStay < value;
        break;
      case "MAX_LOS":
        violated = onArrival && lengthOfStay > value;
        break;
      case "MIN_STAY_THROUGH":
        violated = onStayNight && lengthOfStay < value;
        break;
      case "MAX_STAY_THROUGH":
        violated = onStayNight && lengthOfStay > value;
        break;
      case "MIN_ADVANCE_DAYS":
        violated = onArrival && advanceDays < value;
        break;
      case "MAX_ADVANCE_DAYS":
        violated = onArrival && advanceDays > value;
        break;
    }
    if (violated) violations.push({ type: row.type, date: row.stayDate, value: row.value });
  }
  return violations;
}
