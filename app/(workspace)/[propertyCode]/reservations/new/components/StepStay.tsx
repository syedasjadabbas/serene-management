"use client";

import { useEffect, useRef } from "react";
import { AvailabilityResults } from "@/components/reservations/AvailabilityResults";
import { StaySearchForm } from "@/components/reservations/StaySearchForm";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useAvailabilityQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import type {
  RateQuoteView,
  RoomTypeAvailabilityView,
} from "@/modules/availability/availability.types";
import { addDays } from "@/modules/business-date/business-date.policy";
import { useBookingDraft } from "../store/bookingDraft.store";

/** Step 1: search availability and pick a room type + rate plan (or the waitlist). */
export function StepStay({
  businessDate,
  preselect,
}: {
  businessDate: string;
  preselect: { roomTypeId: string | null; ratePlanId: string | null };
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const { stay, setStay, select } = useBookingDraft();
  const availability = useAvailabilityQuery(
    { propertyId: property.id, ...(stay ?? {}) },
    { skip: !stay },
  );
  const error = toClientApiError(availability.error);
  const preselected = useRef(false);

  function choose(roomType: RoomTypeAvailabilityView, rate: RateQuoteView, waitlist: boolean) {
    select({
      roomTypeId: roomType.roomType.id,
      roomTypeLabel: `${roomType.roomType.code} · ${roomType.roomType.name}`,
      ratePlanId: rate.ratePlan.id,
      ratePlanLabel: `${rate.ratePlan.code} · ${rate.ratePlan.name}`,
      total: rate.total,
      currencyCode: rate.currencyCode,
      waitlist,
    });
  }

  const sellable = (roomType: RoomTypeAvailabilityView, rate: RateQuoteView) =>
    rate.bookable && roomType.status === "AVAILABLE";
  const waitlistable = (roomType: RoomTypeAvailabilityView, rate: RateQuoteView) =>
    can("reservations:waitlist") &&
    rate.total !== null &&
    (roomType.status === "SOLD_OUT" || roomType.status === "LIMITED");

  // Arriving from an availability "Book" link: select that rate once it is confirmed sellable.
  useEffect(() => {
    if (preselected.current || !availability.data || !preselect.roomTypeId || !preselect.ratePlanId)
      return;
    preselected.current = true;
    const roomType = availability.data.roomTypes.find(
      (rt) => rt.roomType.id === preselect.roomTypeId,
    );
    const rate = roomType?.rates.find((r) => r.ratePlan.id === preselect.ratePlanId);
    if (roomType && rate && sellable(roomType, rate)) choose(roomType, rate, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability.data]);

  return (
    <section className="flex flex-col gap-3" aria-label="Stay and rate">
      <div className="rounded-lg border border-border-subtle bg-surface p-3">
        <StaySearchForm
          initial={
            stay ?? {
              arrival: businessDate,
              departure: addDays(businessDate, 1),
              adults: 2,
              children: 0,
              rooms: 1,
            }
          }
          businessDate={businessDate}
          onSearch={setStay}
          pending={availability.isFetching}
        />
      </div>
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {!stay ? (
        <StatusPanel
          kind="empty"
          title="Search availability"
          description="Enter the stay, then choose a room type and rate."
        />
      ) : availability.isLoading ? (
        <StatusPanel kind="loading" title="Checking availability" />
      ) : availability.data ? (
        <AvailabilityResults
          view={availability.data}
          renderRateAction={(roomType, rate) =>
            sellable(roomType, rate) ? (
              <Button size="sm" onClick={() => choose(roomType, rate, false)}>
                Select
              </Button>
            ) : waitlistable(roomType, rate) ? (
              <Button size="sm" variant="secondary" onClick={() => choose(roomType, rate, true)}>
                Waitlist
              </Button>
            ) : null
          }
        />
      ) : null}
    </section>
  );
}
