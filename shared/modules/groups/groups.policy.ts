/**
 * Pure group and block rules (isomorphic, unit-tested;
 * docs/DOMAIN_MODEL.md §6.8, docs/PMS_WORKFLOWS.md §18).
 *
 * Inventory meaning of a block status type:
 * - INQUIRY: a sales lead, no inventory effect;
 * - NON_DEDUCT: tentative, visible but not deducted;
 * - DEDUCT: definite, the un-picked-up allocation is held out of house
 *   availability and rooms can be picked up;
 * - CANCEL: lost / cancelled, holds nothing (terminal).
 */

export type BlockStatusType = "INQUIRY" | "NON_DEDUCT" | "DEDUCT" | "CANCEL";
export const GROUP_STATUSES = ["ACTIVE", "CLOSED", "CANCELLED"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

const ALLOWED: Record<BlockStatusType, BlockStatusType[]> = {
  INQUIRY: ["NON_DEDUCT", "DEDUCT", "CANCEL"],
  NON_DEDUCT: ["DEDUCT", "CANCEL"],
  DEDUCT: ["NON_DEDUCT", "CANCEL"],
  CANCEL: [],
};

/** Why a block cannot move from one status type to another (null = allowed). */
export function blockTransitionProblem(
  from: BlockStatusType,
  to: BlockStatusType,
  activePickup: number,
): string | null {
  if (from === "CANCEL") return "A cancelled block cannot change status";
  if (from === to) return null; // e.g. between two DEDUCT statuses (Definite → Actual)
  if (!ALLOWED[from].includes(to)) {
    return `A ${label(from)} block cannot become ${label(to)}`;
  }
  if (from === "DEDUCT" && activePickup > 0) {
    return "The block has picked-up reservations; cancel or move them first";
  }
  return null;
}

function label(type: BlockStatusType) {
  return {
    INQUIRY: "inquiry",
    NON_DEDUCT: "tentative",
    DEDUCT: "definite",
    CANCEL: "cancelled",
  }[type];
}

/** Rooms a block still holds for a (room type, night). */
export function remainingRooms(night: { allocated: number; released: number; pickedUp: number }) {
  return Math.max(0, night.allocated - night.released - night.pickedUp);
}

/**
 * Why a night's allocation cannot be set to `allocated` (null = allowed):
 * it may not drop below what was released, nor — for a non-elastic block —
 * below released + picked up.
 */
export function allocationProblem(
  night: { allocated: number; released: number; pickedUp: number },
  elastic: boolean,
): string | null {
  if (night.allocated < 0) return "The allocation cannot be negative";
  if (night.allocated < night.released) return "The allocation cannot drop below released rooms";
  if (!elastic && night.allocated < night.released + night.pickedUp) {
    return "The allocation cannot drop below the rooms already picked up";
  }
  return null;
}

export interface BlockNight {
  date: string;
  allocated: number;
  pickedUp: number;
  released: number;
}

/** Room-night totals of a block grid (pickup beyond an elastic allocation counts in full). */
export function blockTotals(nights: readonly BlockNight[]) {
  return nights.reduce(
    (acc, n) => ({
      allocated: acc.allocated + n.allocated,
      pickedUp: acc.pickedUp + n.pickedUp,
      released: acc.released + n.released,
      remaining: acc.remaining + remainingRooms(n),
    }),
    { allocated: 0, pickedUp: 0, released: 0, remaining: 0 },
  );
}

/** A pickup stay must lie inside the block's core dates. */
export function stayWithinBlock(
  block: { startDate: string; endDate: string },
  stay: { arrival: string; departure: string },
): boolean {
  return (
    stay.arrival >= block.startDate &&
    stay.departure <= block.endDate &&
    stay.arrival < stay.departure
  );
}
