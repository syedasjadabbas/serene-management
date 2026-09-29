"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stepper } from "@/components/ui/Stepper";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { formatDate } from "@/lib/utils/format";
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
 * With `?walkIn=1` the same workflow books a walk-in: arrival today, one
 * specific room, and an immediate check-in in the same transaction.
 */
export function NewReservationWorkflow() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const businessDate = useBusinessDate();
  const params = useSearchParams();
  const draft = useBookingDraft();
  const walkIn = params.get("walkIn") === "1";

  // Start clean, or pre-filled from an availability "Book" link. Switching
  // property starts a new draft: ids never carry over between properties.
  useEffect(() => {
    const store = useBookingDraft.getState();
    store.reset(property.id);
    store.setMode(walkIn ? "walk-in" : "booking");
    const arrival = params.get("arrival");
    const departure = params.get("departure");
    if (!walkIn && arrival && departure && isDateOnly(arrival) && isDateOnly(departure)) {
      store.setStay({
        arrival,
        departure,
        adults: Number(params.get("adults") ?? 2) || 2,
        children: Number(params.get("children") ?? 0) || 0,
        rooms: Number(params.get("rooms") ?? 1) || 1,
      });
    }
    // Run on entry and on a property switch; later search-param changes do
    // not reset an in-progress draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id]);

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
  if (walkIn && !(can("frontdesk:checkin") && can("rooms:assign"))) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="Walk-ins need the frontdesk:checkin and rooms:assign permissions."
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
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Reservations", href: `/${property.code}/reservations` },
          { label: walkIn ? "Walk-in" : "New reservation" },
        ]}
        title={walkIn ? "Walk-in" : "New reservation"}
        description={
          walkIn
            ? `Arrives today (business date ${formatDate(today)}): book one room and check in at once.`
            : `Business date ${formatDate(today)}. Availability, price and permissions are checked again when you create it.`
        }
      />
      <Stepper
        label="Booking steps"
        steps={STEPS.map((label, index) => {
          const number = (index + 1) as 1 | 2 | 3 | 4;
          const reachable =
            number === 1 ||
            (number === 2 && !!draft.selection) ||
            (number >= 3 && !!draft.selection && !!draft.guest);
          return {
            label,
            state: draft.step === number ? "current" : number < draft.step ? "done" : "upcoming",
            onSelect: reachable ? () => draft.setStep(number) : undefined,
          };
        })}
      />
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
