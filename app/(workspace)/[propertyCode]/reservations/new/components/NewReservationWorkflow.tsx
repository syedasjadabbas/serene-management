"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { cn } from "@/components/ui/cn";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { isDateOnly } from "@/modules/business-date/business-date.policy";
import { useBookingDraft } from "../store/bookingDraft.store";
import { StepDetails } from "./StepDetails";
import { StepGuest } from "./StepGuest";
import { StepReview } from "./StepReview";
import { StepStay } from "./StepStay";

const STEPS = ["Stay & rate", "Guest", "Details", "Review"] as const;

/**
 * Staff booking workflow: search → select room type/rate → guest → details →
 * review → create. Every step re-reads live data; the server re-validates
 * availability, price and permissions when the reservation is created.
 */
export function NewReservationWorkflow() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const businessDate = useBusinessDate();
  const params = useSearchParams();
  const draft = useBookingDraft();

  // Start clean, or pre-filled from an availability "Book" link.
  useEffect(() => {
    const store = useBookingDraft.getState();
    store.reset();
    const arrival = params.get("arrival");
    const departure = params.get("departure");
    if (arrival && departure && isDateOnly(arrival) && isDateOnly(departure)) {
      store.setStay({
        arrival,
        departure,
        adults: Number(params.get("adults") ?? 2) || 2,
        children: Number(params.get("children") ?? 0) || 0,
        rooms: Number(params.get("rooms") ?? 1) || 1,
      });
    }
    // Run once on entry; later URL changes do not reset an in-progress draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading || businessDate.isLoading) return <StatusPanel kind="loading" title="Loading" />;
  if (!can("reservations:create")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the reservations:create permission."
      />
    );
  }
  const today = businessDate.data?.businessDate;
  if (!today) {
    return (
      <StatusPanel
        kind="empty"
        title="Property not live"
        description="Reservations open once the business date is initialized."
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">New reservation</h1>
        <p className="text-xs text-fg-muted">Business date {today}</p>
      </header>
      <nav aria-label="Booking steps">
        <ol className="flex flex-wrap gap-1 text-sm">
          {STEPS.map((label, index) => {
            const number = (index + 1) as 1 | 2 | 3 | 4;
            const reachable =
              number === 1 ||
              (number === 2 && !!draft.selection) ||
              (number >= 3 && !!draft.selection && !!draft.guest);
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={draft.step === number ? "step" : undefined}
                  onClick={() => draft.setStep(number)}
                  className={cn(
                    "rounded-md border px-3 py-1",
                    draft.step === number
                      ? "border-brand bg-brand-subtle font-medium text-brand"
                      : "border-border-subtle text-fg-secondary enabled:hover:bg-surface-sunken disabled:opacity-50",
                  )}
                >
                  {number}. {label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {draft.step === 1 ? (
        <StepStay
          businessDate={today}
          preselect={{ roomTypeId: params.get("roomTypeId"), ratePlanId: params.get("ratePlanId") }}
        />
      ) : null}
      {draft.step === 2 ? <StepGuest /> : null}
      {draft.step === 3 ? <StepDetails /> : null}
      {draft.step === 4 ? <StepReview /> : null}
    </div>
  );
}
