import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { BookingState } from "@/modules/reservations/reservations.policy";

const LABELS: Record<BookingState, { label: string; tone: BadgeTone }> = {
  WAITLISTED: { label: "Waitlisted", tone: "neutral" },
  TENTATIVE: { label: "Tentative", tone: "warning" },
  CONFIRMED: { label: "Confirmed", tone: "info" },
  IN_HOUSE: { label: "In house", tone: "success" },
  CHECKED_OUT: { label: "Checked out", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
  NO_SHOW: { label: "No-show", tone: "danger" },
};

/** Operational reservation state (status + whether the type deducts inventory). */
export function BookingStateBadge({ state }: { state: BookingState }) {
  const { label, tone } = LABELS[state];
  return <Badge tone={tone}>{label}</Badge>;
}

export const BOOKING_STATE_LABELS = Object.fromEntries(
  Object.entries(LABELS).map(([state, { label }]) => [state, label]),
) as Record<BookingState, string>;
