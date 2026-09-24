"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useAvailableRoomsQuery,
  useBookingOptionsQuery,
} from "@/lib/api/endpoints/reservations.api";
import { useBookingDraft } from "../store/bookingDraft.store";

const toOptions = (rows: { id: string; code: string; name: string }[]) =>
  rows.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }));

/** Step 3: guarantee (reservation type), segmentation, ETA, specific room, requests. */
export function StepDetails() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const { stay, selection, details, setDetails, setStep } = useBookingDraft();
  const options = useBookingOptionsQuery(property.id);
  const canPickRoom = can("rooms:assign") && stay?.rooms === 1 && !selection?.waitlist;
  const rooms = useAvailableRoomsQuery(
    {
      propertyId: property.id,
      roomTypeId: selection?.roomTypeId ?? "",
      arrival: stay?.arrival ?? "",
      departure: stay?.departure ?? "",
    },
    { skip: !canPickRoom || !stay || !selection },
  );

  // Defaults: a guaranteed type, and the rate plan's market / source codes.
  useEffect(() => {
    if (!options.data || !selection) return;
    const plan = options.data.ratePlans.find((p) => p.id === selection.ratePlanId);
    const guaranteed = options.data.reservationTypes.find(
      (t) => t.deductsInventory && t.isGuaranteed,
    );
    setDetails({
      reservationTypeId: details.reservationTypeId || guaranteed?.id || "",
      marketCodeId: details.marketCodeId || plan?.defaultMarketCodeId || "",
      sourceCodeId: details.sourceCodeId || plan?.defaultSourceCodeId || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data, selection?.ratePlanId]);

  if (!stay || !selection)
    return <StatusPanel kind="empty" title="Choose a room type and rate first" />;
  if (options.isLoading) return <StatusPanel kind="loading" title="Loading booking options" />;
  if (!options.data)
    return <StatusPanel kind="error" title="Booking options could not be loaded" />;
  const data = options.data;
  const set = (key: keyof typeof details) => (event: { target: { value: string } }) =>
    setDetails({ [key]: event.target.value });
  const selectedType = data.reservationTypes.find((t) => t.id === details.reservationTypeId);

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4"
      aria-label="Booking details"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Reservation type (guarantee)"
          options={data.reservationTypes.map((t) => ({
            value: t.id,
            label: `${t.code} · ${t.name}${t.deductsInventory ? "" : " (tentative)"}`,
          }))}
          value={details.reservationTypeId}
          onChange={set("reservationTypeId")}
          hint={
            selectedType && !selectedType.deductsInventory
              ? "Tentative: does not hold inventory until confirmed"
              : undefined
          }
        />
        <Select
          label="Market segment"
          placeholder="Select"
          options={toOptions(data.marketCodes)}
          value={details.marketCodeId}
          onChange={set("marketCodeId")}
        />
        <Select
          label="Source"
          placeholder="Select"
          options={toOptions(data.sourceCodes)}
          value={details.sourceCodeId}
          onChange={set("sourceCodeId")}
        />
        <Select
          label="Channel"
          placeholder="Not specified"
          options={toOptions(data.channels)}
          value={details.channelId}
          onChange={set("channelId")}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Expected arrival time"
          type="time"
          value={details.eta}
          onChange={set("eta")}
          hint="Property local time"
        />
        {canPickRoom ? (
          <Select
            label="Room (optional)"
            placeholder={rooms.isLoading ? "Loading rooms…" : "Assign later"}
            options={(rooms.data ?? []).map((r) => ({
              value: r.id,
              label: `${r.number}${r.floor ? ` · ${r.floor}` : ""} · ${r.housekeepingStatus.toLowerCase()}`,
            }))}
            value={details.roomId}
            onChange={set("roomId")}
            hint={rooms.data ? `${rooms.data.length} free for the whole stay` : undefined}
          />
        ) : null}
      </div>
      <TextArea
        label="Special requests"
        value={details.specialRequests}
        onChange={set("specialRequests")}
        maxLength={2000}
      />
      <div className="flex gap-2">
        <Button
          onClick={() => setStep(4)}
          disabled={!details.reservationTypeId || !details.marketCodeId || !details.sourceCodeId}
        >
          Review
        </Button>
        <Button variant="ghost" onClick={() => setStep(2)}>
          Back
        </Button>
      </div>
    </section>
  );
}
