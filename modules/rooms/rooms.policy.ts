/**
 * Pure room-status rules (isomorphic, unit-tested). A room has independent
 * axes (docs/DOMAIN_MODEL.md §5.2): occupancy (front office), housekeeping
 * status, and service (out of order / out of service, from room service
 * blocks). Readiness for a guest is derived from all three; maintenance
 * requests are a separate concern that can place a service block.
 */

export const HOUSEKEEPING_STATUSES = ["CLEAN", "DIRTY", "PICKUP", "INSPECTED"] as const;
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];
export type FrontOfficeStatus = "VACANT" | "OCCUPIED";

export interface RoomStatusSnapshot {
  housekeepingStatus: HousekeepingStatus;
  frontOfficeStatus: FrontOfficeStatus;
  /** An out-of-order block covers the business date (removed from inventory). */
  outOfOrder: boolean;
  /** An out-of-service block covers the business date (sellable, not to be used). */
  outOfService: boolean;
}

export type RoomReadiness =
  "READY" | "OCCUPIED" | "OUT_OF_ORDER" | "OUT_OF_SERVICE" | "DIRTY" | "NOT_INSPECTED";

/**
 * Whether a guest can be put into the room now. Out of order and occupied
 * rooms are never usable. Out of service, dirty and uninspected rooms are
 * "not ready": usable only with an explicit, audited override.
 */
export function roomReadiness(room: RoomStatusSnapshot, requireInspected: boolean): RoomReadiness {
  if (room.outOfOrder) return "OUT_OF_ORDER";
  if (room.frontOfficeStatus === "OCCUPIED") return "OCCUPIED";
  if (room.outOfService) return "OUT_OF_SERVICE";
  if (room.housekeepingStatus === "INSPECTED") return "READY";
  if (room.housekeepingStatus === "CLEAN") return requireInspected ? "NOT_INSPECTED" : "READY";
  return "DIRTY";
}

/** Readiness problems that an authorized override may accept. */
export function isOverridableReadiness(readiness: RoomReadiness): boolean {
  return readiness === "DIRTY" || readiness === "NOT_INSPECTED" || readiness === "OUT_OF_SERVICE";
}

export const READINESS_LABELS: Record<RoomReadiness, string> = {
  READY: "Ready",
  OCCUPIED: "Occupied",
  OUT_OF_ORDER: "Out of order",
  OUT_OF_SERVICE: "Out of service",
  DIRTY: "Not clean",
  NOT_INSPECTED: "Not inspected",
};

export type RoomBoardStatus =
  "OUT_OF_ORDER" | "OUT_OF_SERVICE" | "OCCUPIED" | "VACANT_READY" | "VACANT_NOT_READY";

export function roomBoardStatus(
  room: RoomStatusSnapshot,
  requireInspected: boolean,
): RoomBoardStatus {
  const readiness = roomReadiness(room, requireInspected);
  if (readiness === "OUT_OF_ORDER") return "OUT_OF_ORDER";
  if (readiness === "OCCUPIED") return "OCCUPIED";
  if (readiness === "OUT_OF_SERVICE") return "OUT_OF_SERVICE";
  return readiness === "READY" ? "VACANT_READY" : "VACANT_NOT_READY";
}

export const ROOM_BOARD_STATUS_LABELS: Record<RoomBoardStatus, string> = {
  OUT_OF_ORDER: "Out of order",
  OUT_OF_SERVICE: "Out of service",
  OCCUPIED: "Occupied",
  VACANT_READY: "Vacant · ready",
  VACANT_NOT_READY: "Vacant · not ready",
};

export const ROOM_BOARD_FILTERS = [
  "all",
  "vacant_ready",
  "vacant_not_ready",
  "occupied",
  "vacant",
  "out_of_order",
  "out_of_service",
  "arriving",
  "departing",
  "dirty",
  "clean",
  "inspected",
  "maintenance",
] as const;
export type RoomBoardFilter = (typeof ROOM_BOARD_FILTERS)[number];

/** Source tags recorded in room_status_history. */
export type RoomStatusSource =
  "CHECK_IN" | "CHECK_OUT" | "ROOM_MOVE" | "HOUSEKEEPING" | "MAINTENANCE" | "USER";

// --- Housekeeping status transitions (room level) ---------------------------------------

export type HousekeepingAction = "mark_dirty" | "mark_clean" | "inspect_pass" | "inspect_fail";

/**
 * Legal housekeeping-status transitions. The target status is decided by the
 * server from the action, never supplied by the client. Returns the next
 * status, or a problem description.
 */
export function housekeepingTransition(
  action: HousekeepingAction,
  current: HousekeepingStatus,
): { next: HousekeepingStatus } | { problem: string } {
  switch (action) {
    case "mark_dirty":
      return current === "DIRTY" ? { problem: "The room is already dirty" } : { next: "DIRTY" };
    case "mark_clean":
      return current === "DIRTY" || current === "PICKUP"
        ? { next: "CLEAN" }
        : { problem: `A ${current.toLowerCase()} room cannot be marked clean` };
    case "inspect_pass":
      return current === "CLEAN"
        ? { next: "INSPECTED" }
        : { problem: "Only a clean room can pass inspection" };
    case "inspect_fail":
      return current === "CLEAN" || current === "INSPECTED"
        ? { next: "DIRTY" }
        : { problem: "Only a clean or inspected room can fail inspection" };
  }
}
