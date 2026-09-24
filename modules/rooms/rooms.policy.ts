/**
 * Pure room-status rules (isomorphic, unit-tested): readiness for putting a
 * guest into a room and the front desk's room board classification
 * (docs/DOMAIN_MODEL.md §5.2, §6.2). Housekeeping workflows (cleaning,
 * inspection, task sheets) arrive with Phase 4.
 */

export const HOUSEKEEPING_STATUSES = ["CLEAN", "DIRTY", "PICKUP", "INSPECTED"] as const;
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];
export type FrontOfficeStatus = "VACANT" | "OCCUPIED";

export interface RoomStatusSnapshot {
  housekeepingStatus: HousekeepingStatus;
  frontOfficeStatus: FrontOfficeStatus;
  /** An out-of-order block covers the business date. */
  outOfOrder: boolean;
}

export type RoomReadiness = "READY" | "OCCUPIED" | "OUT_OF_ORDER" | "DIRTY" | "NOT_INSPECTED";

/**
 * Whether a guest can be put into the room now. Out of order and occupied
 * rooms are never usable; dirty or uninspected rooms are "not ready" and
 * usable only with an explicit, audited override.
 */
export function roomReadiness(room: RoomStatusSnapshot, requireInspected: boolean): RoomReadiness {
  if (room.outOfOrder) return "OUT_OF_ORDER";
  if (room.frontOfficeStatus === "OCCUPIED") return "OCCUPIED";
  if (room.housekeepingStatus === "INSPECTED") return "READY";
  if (room.housekeepingStatus === "CLEAN") return requireInspected ? "NOT_INSPECTED" : "READY";
  return "DIRTY";
}

/** Readiness problems that an authorized override may accept. */
export function isOverridableReadiness(readiness: RoomReadiness): boolean {
  return readiness === "DIRTY" || readiness === "NOT_INSPECTED";
}

export const READINESS_LABELS: Record<RoomReadiness, string> = {
  READY: "Ready",
  OCCUPIED: "Occupied",
  OUT_OF_ORDER: "Out of order",
  DIRTY: "Not clean",
  NOT_INSPECTED: "Not inspected",
};

export type RoomBoardStatus = "OUT_OF_ORDER" | "OCCUPIED" | "VACANT_READY" | "VACANT_NOT_READY";

export function roomBoardStatus(
  room: RoomStatusSnapshot,
  requireInspected: boolean,
): RoomBoardStatus {
  const readiness = roomReadiness(room, requireInspected);
  if (readiness === "OUT_OF_ORDER") return "OUT_OF_ORDER";
  if (readiness === "OCCUPIED") return "OCCUPIED";
  return readiness === "READY" ? "VACANT_READY" : "VACANT_NOT_READY";
}

export const ROOM_BOARD_STATUS_LABELS: Record<RoomBoardStatus, string> = {
  OUT_OF_ORDER: "Out of order",
  OCCUPIED: "Occupied",
  VACANT_READY: "Vacant · ready",
  VACANT_NOT_READY: "Vacant · not ready",
};

export const ROOM_BOARD_FILTERS = [
  "all",
  "vacant_ready",
  "vacant_not_ready",
  "occupied",
  "out_of_order",
  "arriving",
] as const;
export type RoomBoardFilter = (typeof ROOM_BOARD_FILTERS)[number];

/** Source tags recorded in room_status_history. */
export type RoomStatusSource = "CHECK_IN" | "CHECK_OUT" | "ROOM_MOVE";
