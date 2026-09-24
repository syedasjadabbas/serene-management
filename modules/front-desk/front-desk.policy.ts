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
export type StayAction = "check_out" | "room_move";

/** Stay state machine guard (docs/DOMAIN_MODEL.md §6.3). */
export function stayTransitionProblem(action: StayAction, status: StayStatus): string | null {
  if (status === "IN_HOUSE") return null;
  return action === "check_out"
    ? "The guest has already checked out"
    : "Only in-house guests can change rooms";
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
