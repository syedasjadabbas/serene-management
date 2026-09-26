"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useAvailableRoomsQuery,
  useBookingOptionsQuery,
  useCreateReservationMutation,
} from "@/lib/api/endpoints/reservations.api";
import { useWalkInMutation } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, pluralize } from "@/lib/utils/format";
import { nightCount } from "@/modules/reservations/reservations.policy";
import { useBookingDraft } from "../store/bookingDraft.store";

/** Step 4: review and create. The server re-checks availability, price and permissions. */
export function StepReview() {
  const property = useProperty();
  const router = useRouter();
  const { can } = usePermissions(property.id);
  const { stay, selection, guest, details, setStep, reset, mode, company, propertyId } =
    useBookingDraft();
  const walkIn = mode === "walk-in";
  const options = useBookingOptionsQuery(property.id);
  // Same arguments as step 3, so this is served from the cache.
  const rooms = useAvailableRoomsQuery(
    {
      propertyId: property.id,
      roomTypeId: selection?.roomTypeId ?? "",
      arrival: stay?.arrival ?? "",
      departure: stay?.departure ?? "",
    },
    { skip: !details.roomId || !stay || !selection },
  );
  const [createReservation, created] = useCreateReservationMutation();
  const [walkInMutation, walkedIn] = useWalkInMutation();
  const isLoading = created.isLoading || walkedIn.isLoading;
  const error = created.error ?? walkedIn.error;
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const apiError = toClientApiError(error);

  if (!stay || !selection || !guest || propertyId !== property.id)
    return <StatusPanel kind="empty" title="The booking is incomplete" />;
  const label = (list: { id: string; code: string; name: string }[] | undefined, id: string) => {
    const item = list?.find((x) => x.id === id);
    return item ? `${item.code} · ${item.name}` : "—";
  };
  const nights = nightCount(stay.arrival, stay.departure);
  const canOverride = can("reservations:override_availability");
  const reservationType = options.data?.reservationTypes.find(
    (t) => t.id === details.reservationTypeId,
  );
  const roomNumber = rooms.data?.find((room) => room.id === details.roomId)?.number;
  const initialState = walkIn
    ? "In house (checked in on creation)"
    : selection.waitlist
      ? "Waitlisted (no inventory held)"
      : reservationType && !reservationType.deductsInventory
        ? "Tentative (inventory not deducted)"
        : "Confirmed";

  async function create() {
    if (!stay || !selection || !guest) return;
    const body = {
      ...stay,
      roomTypeId: selection.roomTypeId,
      ratePlanId: selection.ratePlanId,
      reservationTypeId: details.reservationTypeId,
      guestId: guest.id,
      marketCodeId: details.marketCodeId,
      sourceCodeId: details.sourceCodeId,
      ...(details.channelId ? { channelId: details.channelId } : {}),
      ...(details.roomId ? { roomId: details.roomId } : {}),
      ...(details.eta ? { eta: details.eta } : {}),
      ...(details.specialRequests ? { specialRequests: details.specialRequests } : {}),
      ...(company ? { companyId: company.id } : {}),
      ...(company && details.bookerGuestId ? { bookerGuestId: details.bookerGuestId } : {}),
      waitlist: selection.waitlist,
      ...(override ? { override: true, reason } : {}),
    };
    if (walkIn) {
      const result = await walkInMutation({ propertyId: property.id, body });
      if ("data" in result && result.data) {
        reset(property.id);
        router.push(`/${property.code}/front-desk/stays/${result.data.id}?checkedIn=1` as Route);
      }
      return;
    }
    const result = await createReservation({ propertyId: property.id, body });
    if ("data" in result && result.data) {
      reset(property.id);
      router.push(`/${property.code}/reservations/${result.data.id}?created=1` as Route);
    }
  }

  const rows: [string, string][] = [
    [
      "Stay",
      `${formatDate(stay.arrival)} → ${formatDate(stay.departure)} (${pluralize(nights, "night")})`,
    ],
    [
      "Party",
      `${pluralize(stay.adults, "adult")}${stay.children ? `, ${pluralize(stay.children, "child", "children")}` : ""} per room`,
    ],
    ["Rooms", String(stay.rooms)],
    ["Room type", selection.roomTypeLabel],
    ["Rate plan", selection.ratePlanLabel],
    ["Room", details.roomId ? (roomNumber ?? "Selected room") : "Assign later"],
    ["Total per room", formatCurrency(selection.total, selection.currencyCode)],
    ["Guest", guest.label],
    ...(company ? ([["Company", company.label]] as [string, string][]) : []),
    ["Reservation type", label(options.data?.reservationTypes, details.reservationTypeId)],
    [
      "Market / source",
      `${label(options.data?.marketCodes, details.marketCodeId)} / ${label(options.data?.sourceCodes, details.sourceCodeId)}`,
    ],
    ["Status on creation", initialState],
  ];

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4"
      aria-label="Review"
    >
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-xs text-fg-muted sm:py-0.5">{term}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      {details.specialRequests ? (
        <p className="text-sm text-fg-secondary">Requests: {details.specialRequests}</p>
      ) : null}
      {apiError ? (
        <Alert tone="danger">
          {apiError.message}
          {apiError.code === "BUSINESS_RULE_VIOLATION" ? (
            <span className="block text-xs">
              Go back to step 1 to search again{canOverride ? ", or override with a reason" : ""}.
            </span>
          ) : null}
        </Alert>
      ) : null}
      {canOverride ? (
        <fieldset className="flex flex-wrap items-end gap-3 rounded-md border border-border-subtle p-3">
          <legend className="px-1 text-xs text-fg-secondary">Manager override</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            Book even if availability or restrictions do not allow it
          </label>
          {override ? (
            <TextField
              label="Reason (audited)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-w-72 flex-1"
            />
          ) : null}
        </fieldset>
      ) : null}
      <div className="flex gap-2">
        <Button
          onClick={() => void create()}
          pending={isLoading}
          disabled={override && reason.trim().length < 3}
        >
          {walkIn ? "Create and check in" : "Create reservation"}
        </Button>
        <Button variant="ghost" onClick={() => setStep(3)}>
          Back
        </Button>
      </div>
    </section>
  );
}
