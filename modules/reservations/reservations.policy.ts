/**
 * Pure reservation rules (isomorphic, unit-tested): hotel-night semantics,
 * overlap, occupancy, and the reservation state machine
 * (docs/DOMAIN_MODEL.md §6.1).
 */
import { addDays, daysBetween } from "@/modules/business-date/business-date.policy";

export const RESERVATION_STATUSES = [
  "WAITLISTED",
  "RESERVED",
  "IN_HOUSE",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const MAX_STAY_NIGHTS = 90;
export const MAX_ROOMS_PER_BOOKING = 20;

/**
 * Stay nights for [arrival, departure): arrival is inclusive, departure is
 * exclusive (the room is free on the departure date).
 * 2026-10-10 → 2026-10-13 = ["2026-10-10", "2026-10-11", "2026-10-12"].
 */
export function stayNights(arrival: string, departure: string): string[] {
  const count = daysBetween(arrival, departure);
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => addDays(arrival, i));
}

export function nightCount(arrival: string, departure: string): number {
  return Math.max(0, daysBetween(arrival, departure));
}

/** Half-open interval overlap: a checkout and a check-in on the same date do not overlap. */
export function staysOverlap(
  a: { arrival: string; departure: string },
  b: { arrival: string; departure: string },
): boolean {
  return a.arrival < b.departure && a.departure > b.arrival;
}

export interface OccupancyLimits {
  maxOccupancy: number;
  maxAdults: number;
  maxChildren: number;
}

export type OccupancyProblem =
  "TOO_MANY_ADULTS" | "TOO_MANY_CHILDREN" | "TOO_MANY_GUESTS" | "NO_ADULT";

export function occupancyProblems(
  limits: OccupancyLimits,
  adults: number,
  children: number,
): OccupancyProblem[] {
  const problems: OccupancyProblem[] = [];
  if (adults < 1) problems.push("NO_ADULT");
  if (adults > limits.maxAdults) problems.push("TOO_MANY_ADULTS");
  if (children > limits.maxChildren) problems.push("TOO_MANY_CHILDREN");
  if (adults + children > limits.maxOccupancy) problems.push("TOO_MANY_GUESTS");
  return problems;
}

/**
 * Operational state shown to staff. Tentative vs confirmed is not a separate
 * status: it is whether the reservation (guarantee) type deducts inventory.
 */
export type BookingState =
  "WAITLISTED" | "TENTATIVE" | "CONFIRMED" | "IN_HOUSE" | "CHECKED_OUT" | "CANCELLED" | "NO_SHOW";

export function bookingState(status: ReservationStatus, deductsInventory: boolean): BookingState {
  if (status === "RESERVED") return deductsInventory ? "CONFIRMED" : "TENTATIVE";
  return status;
}

/** Whether a reservation room currently consumes sellable inventory. */
export function consumesInventory(status: ReservationStatus, deductsInventory: boolean): boolean {
  return deductsInventory && (status === "RESERVED" || status === "IN_HOUSE");
}

export type ReservationAction =
  | "modify"
  | "confirm"
  | "cancel"
  | "no_show"
  | "reinstate"
  | "reinstate_no_show"
  | "assign_room"
  | "check_in"
  | "check_out"
  | "room_move"
  | "extend";

/**
 * State machine guard. Returns null when allowed, otherwise the reason.
 * Business-date guards (e.g. no-show only once arrival ≤ business date)
 * receive the property's current business date, never the client's clock.
 */
export function transitionProblem(
  action: ReservationAction,
  current: {
    status: ReservationStatus;
    deductsInventory: boolean;
    arrival: string;
    departure: string;
  },
  businessDate: string,
): string | null {
  const { status } = current;
  switch (action) {
    case "modify":
    case "assign_room":
      return status === "RESERVED" || status === "WAITLISTED"
        ? null
        : `A ${label(status)} reservation cannot be changed`;
    case "confirm":
      if (status === "WAITLISTED") return null;
      if (status === "RESERVED")
        return current.deductsInventory ? "The reservation is already confirmed" : null;
      return `A ${label(status)} reservation cannot be confirmed`;
    case "cancel":
      return status === "RESERVED" || status === "WAITLISTED"
        ? null
        : `A ${label(status)} reservation cannot be cancelled`;
    case "no_show":
      if (status !== "RESERVED")
        return `A ${label(status)} reservation cannot be marked as a no-show`;
      return current.arrival <= businessDate
        ? null
        : "A reservation can be marked as a no-show only on or after its arrival date";
    case "reinstate":
      if (status !== "CANCELLED") return `A ${label(status)} reservation cannot be reinstated`;
      return current.arrival >= businessDate
        ? null
        : "Only cancellations with an arrival on or after the business date can be reinstated";
    case "reinstate_no_show":
      if (status !== "NO_SHOW")
        return `A ${label(status)} reservation cannot be reinstated as a no-show`;
      return current.departure > businessDate
        ? null
        : "The stay has ended; a no-show can be reinstated only while nights remain";
    case "check_in":
      if (status !== "RESERVED") return `A ${label(status)} reservation cannot be checked in`;
      if (!current.deductsInventory) return "Confirm the reservation before checking the guest in";
      if (current.arrival > businessDate)
        return `The guest arrives on ${current.arrival}; check-in opens on the arrival date`;
      if (current.arrival < businessDate)
        return `The arrival date ${current.arrival} has passed. Update the arrival date or mark the reservation as a no-show`;
      return current.departure > businessDate ? null : "Day-use stays cannot be checked in yet";
    case "check_out":
      return status === "IN_HOUSE" ? null : `A ${label(status)} reservation cannot be checked out`;
    case "room_move":
      return status === "IN_HOUSE"
        ? null
        : `Only in-house guests can be moved; use room assignment for a ${label(status)} reservation`;
    case "extend":
      return status === "IN_HOUSE"
        ? null
        : `Only in-house stays can be extended; modify a ${label(status)} reservation instead`;
  }
}

function label(status: ReservationStatus): string {
  return status.toLowerCase().replace("_", "-");
}

/** Human-friendly confirmation number from the property's gap-free sequence value. */
export function formatConfirmationNumber(prefix: string, value: bigint | number): string {
  return `${prefix}${value.toString()}`;
}

/** "<confirmation>-<line>" for multi-room bookings, plain for single rooms. */
export function displayConfirmation(
  confirmationNumber: string,
  lineNumber: number,
  roomCount: number,
): string {
  return roomCount > 1 ? `${confirmationNumber}-${lineNumber}` : confirmationNumber;
}
