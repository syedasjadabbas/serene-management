/**
 * Pure front-desk rules (isomorphic, unit-tested): check-out timing against
 * the business date, the stay state machine and the operational states of
 * the arrivals list (docs/PMS_WORKFLOWS.md §5–§9, docs/DOMAIN_MODEL.md §6.3).
 * Room readiness lives in modules/rooms/rooms.policy.ts.
 */
import type { RoomReadiness } from "@/modules/rooms/rooms.policy";

/**
 * Check-out timing (departure is exclusive, so the normal check-out day is
 * the departure date):
 * - ON_TIME: departure = business date
 * - OVERSTAY: departure < business date (the business date has moved on)
 * - EARLY: departure > business date and at least one night was used
 * - SAME_DAY: checked in on the business date, no night used yet; the
 *   correction is a reverse check-in, not a check-out
 */
export type CheckoutTiming = "ON_TIME" | "OVERSTAY" | "EARLY" | "SAME_DAY";

export function checkoutTiming(
  stay: { arrival: string; departure: string },
  businessDate: string,
): CheckoutTiming {
  if (stay.departure === businessDate) return "ON_TIME";
  if (stay.departure < businessDate) return "OVERSTAY";
  return stay.arrival < businessDate ? "EARLY" : "SAME_DAY";
}

export type StayStatus = "IN_HOUSE" | "CHECKED_OUT";
export type StayAction = "check_out" | "room_move" | "extend";

/** Stay state machine guard (docs/DOMAIN_MODEL.md §6.3). */
export function stayTransitionProblem(action: StayAction, status: StayStatus): string | null {
  if (status === "IN_HOUSE") return null;
  if (action === "check_out") return "The guest has already checked out";
  return action === "extend"
    ? "Only in-house stays can be extended"
    : "Only in-house guests can change rooms";
}

/**
 * Reverse check-in (PMS_WORKFLOWS §6.3, DOMAIN_MODEL IN_HOUSE → RESERVED): the
 * correction for a guest checked in by mistake or leaving on the arrival day.
 * Only on the business date of the check-in, and only while nothing has been
 * posted to the stay's folio: the ledger is append-only, so a stay with
 * postings really happened and is closed by check-out instead.
 */
export function reverseCheckInProblem(input: {
  status: StayStatus;
  arrivalBusinessDate: string;
  businessDate: string;
  postings: number;
}): { message: string; reason: string } | null {
  if (input.status !== "IN_HOUSE") {
    return { message: "Only an in-house stay can be reversed", reason: "NOT_IN_HOUSE" };
  }
  if (input.arrivalBusinessDate !== input.businessDate) {
    return {
      message:
        "Only a check-in made on the current business date can be reversed; check the guest out instead",
      reason: "NOT_SAME_BUSINESS_DATE",
    };
  }
  if (input.postings > 0) {
    return {
      message:
        "The folio already has postings, so the check-in cannot be undone. Settle the folio; the stay is checked out on its departure date",
      reason: "FOLIO_HAS_POSTINGS",
    };
  }
  return null;
}

/** Operational state of a due-in row, in the order staff resolve them. */
export type ArrivalState =
  "CHECKED_IN" | "NEEDS_CONFIRMATION" | "UNASSIGNED" | "ROOM_NOT_READY" | "READY";

export function arrivalState(input: {
  status: string;
  deductsInventory: boolean;
  hasRoom: boolean;
  readiness: RoomReadiness | null;
}): ArrivalState {
  if (input.status === "IN_HOUSE" || input.status === "CHECKED_OUT") return "CHECKED_IN";
  if (!input.deductsInventory) return "NEEDS_CONFIRMATION";
  if (!input.hasRoom) return "UNASSIGNED";
  return input.readiness === "READY" ? "READY" : "ROOM_NOT_READY";
}

export const ARRIVAL_STATE_LABELS: Record<ArrivalState, string> = {
  CHECKED_IN: "Checked in",
  NEEDS_CONFIRMATION: "Needs confirmation",
  UNASSIGNED: "No room",
  ROOM_NOT_READY: "Room not ready",
  READY: "Ready",
};

export const ARRIVAL_FILTERS = [
  "all",
  "pending",
  "unassigned",
  "assigned",
  "checked_in",
  "vip",
] as const;
export type ArrivalFilter = (typeof ARRIVAL_FILTERS)[number];

export const IN_HOUSE_FILTERS = ["all", "arrived_today", "due_out"] as const;
export type InHouseFilter = (typeof IN_HOUSE_FILTERS)[number];

export const DEPARTURE_FILTERS = ["all", "due_out", "departed"] as const;
export type DepartureFilter = (typeof DEPARTURE_FILTERS)[number];
