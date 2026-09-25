/** Loyalty rules (isomorphic, pure). */

export type MembershipStatus = "ACTIVE" | "INACTIVE";

/** Whole points as bigint; null when not an integer string. */
export function parsePoints(value: string): bigint | null {
  return /^-?\d+$/.test(value.trim()) ? BigInt(value.trim()) : null;
}

/** New balance after an adjustment; null when it would go negative. */
export function adjustedBalance(balance: bigint, points: bigint): bigint | null {
  const next = balance + points;
  return next < 0n ? null : next;
}

/** Why a membership change is refused, or null. */
export function membershipChangeProblem(
  current: { tierId: string | null; status: MembershipStatus },
  next: { tierId?: string | null; status?: MembershipStatus },
  tier: { programMatches: boolean; active: boolean } | null,
): string | null {
  const tierChanges = next.tierId !== undefined && next.tierId !== current.tierId;
  const statusChanges = next.status !== undefined && next.status !== current.status;
  if (!tierChanges && !statusChanges) return "Nothing to change";
  if (tierChanges && next.tierId) {
    if (!tier || !tier.programMatches) return "The tier does not belong to this program";
    if (!tier.active) return "The tier is not active";
  }
  if (tierChanges && current.status === "INACTIVE" && next.status !== "ACTIVE") {
    return "Re-activate the membership before changing its tier";
  }
  return null;
}

/** "<PROGRAM><7 digits>" style membership number from random digits. */
export function membershipNumber(programCode: string, digits: string): string {
  return `${programCode}${digits}`.slice(0, 40);
}
