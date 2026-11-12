"use client";

import { useController } from "react-hook-form";
import { useState } from "react";
import { GuestPicker } from "@/global/components/guests/GuestPicker";
import {
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { useProperty } from "@/global/hooks/useProperty";
import { usePickupMutation } from "@/global/api/endpoints/groupsApi";
import { toClientApiError } from "@/global/api/errors";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import type { BlockView } from "@serene/shared/modules/groups/groups.types";
import { randomId } from "@serene/shared/lib/utils/random-id";
import { DigitsField } from "../../_components/DigitsField";
import { pickupBody, pickupDefaults, pickupFormSchema } from "../../_lib/groupForms";
import { OverrideField } from "./OverrideField";

export function PickupDialog({ block, onClose }: { block: BlockView; onClose: () => void }) {
  const property = useProperty();
  const [pickup, state] = usePickupMutation();
  const [idempotencyKey] = useState(randomId);
  const { control, handleSubmit, setError, watch, formState } = useZodForm(
    pickupFormSchema,
    pickupDefaults(block.roomTypes[0]?.roomType.id ?? "", block.startDate, block.endDate),
  );
  const guestField = useController({ control, name: "guest" });
  const [roomTypeId, override] = watch(["roomTypeId", "override"]);
  const [done, setDone] = useState<string | null>(null);
  const error = toClientApiError(state.error);
  const remaining = block.roomTypes.find((rt) => rt.roomType.id === roomTypeId);

  if (done) {
    return (
      <FormDialog
        title="Picked up"
        onClose={onClose}
        onSubmit={onClose}
        submitLabel="Done"
        pending={false}
        error={null}
      >
        <p className="text-sm">
          The reservation was created at the block&apos;s rate (
          {block.ratePlan?.code ?? "block rate"}) and the pickup count updated.
        </p>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title={`Pick up · ${block.code}`}
      description={`Rate ${block.ratePlan?.code ?? "—"} and booking codes come from the block; the server prices every night.`}
      size="lg"
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        if (!values.guest) return;
        const result = await pickup({
          propertyId: property.id,
          blockId: block.id,
          idempotencyKey,
          body: pickupBody(values, values.guest.id),
        });
        if ("data" in result && result.data) setDone(result.data.reservationId);
        else if ("error" in result) applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Create pickup"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <GuestPicker value={guestField.field.value} onChange={guestField.field.onChange} />
      {guestField.fieldState.error?.message ? (
        <p role="alert" className="text-xs text-danger">
          {guestField.fieldState.error.message}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="roomTypeId"
          label="Room type"
          options={block.roomTypes.map((rt) => ({
            value: rt.roomType.id,
            label: `${rt.roomType.code} · ${rt.totals.remaining} room-nights left`,
          }))}
        />
        <DigitsField control={control} name="rooms" label="Rooms" maxLength={1} />
        <FormTextField
          control={control}
          name="arrival"
          label="Arrival"
          type="date"
          min={block.startDate}
          max={addDays(block.endDate, -1)}
        />
        <FormTextField
          control={control}
          name="departure"
          label="Departure"
          type="date"
          min={addDays(block.startDate, 1)}
          max={block.endDate}
        />
        <DigitsField control={control} name="adults" label="Adults per room" maxLength={2} />
      </div>
      {remaining ? (
        <p className="text-xs text-fg-muted">
          Held for {remaining.roomType.code}: {remaining.totals.allocated} room-nights,{" "}
          {remaining.totals.pickedUp} picked up. The server re-counts under a lock before creating
          the reservation.
        </p>
      ) : null}
      <OverrideField control={control} label="Overbook the house if needed (audited)" />
      {override ? (
        <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={1000} />
      ) : null}
    </FormDialog>
  );
}
