"use client";

import { useEffect, useRef } from "react";
import { AvailabilityResults } from "@/global/components/reservations/AvailabilityResults";
import { StaySearchForm } from "@/global/components/reservations/StaySearchForm";
import { Alert } from "@/global/components/ui/Alert";
import { Button } from "@/global/components/ui/Button";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";
import { CompanyPicker } from "@/global/components/accounts/CompanyPicker";
import { useAvailabilityQuery } from "@/global/api/endpoints/reservationsApi";
import { toClientApiError } from "@/global/api/errors";
import type {
  RateQuoteView,
  RoomTypeAvailabilityView,
} from "@serene/shared/modules/availability/availability.types";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import { useBookingDraft } from "../_lib/bookingDraft.store";

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
  const { stay, setStay, select, mode, company, setCompany } = useBookingDraft();
  const walkIn = mode === "walk-in";
  const availability = useAvailabilityQuery(
    { propertyId: property.id, ...(stay ?? {}), ...(company ? { companyId: company.id } : {}) },
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
    !walkIn &&
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
      <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-card">
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
          walkIn={walkIn}
          onSearch={setStay}
          pending={availability.isFetching}
        />
        {can("accounts:read") ? (
          <div className="mt-3 max-w-md border-t border-border-subtle pt-3">
            <CompanyPicker
              value={company}
              onChange={setCompany}
              label="Booking for a company (shows its negotiated rates)"
            />
          </div>
        ) : null}
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
