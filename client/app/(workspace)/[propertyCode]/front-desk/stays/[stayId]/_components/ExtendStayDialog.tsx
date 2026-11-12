"use client";

import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormCheckbox,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";
import { useExtendStayMutation } from "@/global/api/endpoints/frontDeskApi";
import { toClientApiError } from "@/global/api/errors";
import { formatDate } from "@serene/shared/lib/utils/format";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import type { StayDetail } from "@serene/shared/modules/front-desk/front-desk.types";
import { extendStayDefaults, extendStayFormSchema } from "../_lib/extendStayForm";

/**
 * In-house extension to a later departure. The added nights are priced by
 * the server and take availability; the guest keeps the same room, which
 * must be free for them. Night audit will not close a date while a guest
 * due out has neither left nor been extended.
 */
export function ExtendStayDialog({ stay, onClose }: { stay: StayDetail; onClose: () => void }) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const form = useZodForm(extendStayFormSchema(stay.departure), extendStayDefaults(stay.departure));
  const { control, handleSubmit, setError, watch, formState } = form;
  const override = watch("override");
  const [extend, { isLoading, error }] = useExtendStayMutation();
  const apiError = toClientApiError(error);
  const canOverride = can("reservations:override_availability");

  async function submit(values: { departure: string; override: boolean; reason: string }) {
    const result = await extend({
      propertyId: property.id,
      stayId: stay.id,
      body: {
        version: stay.version,
        departure: values.departure,
        ...(values.override ? { override: true, reason: values.reason.trim() } : {}),
      },
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title="Extend stay"
      description={`${stay.guest.name} · room ${stay.room.number} · booked until ${formatDate(stay.departure)}`}
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Extend stay"
      pending={isLoading || formState.isSubmitting}
      error={apiError}
    >
      <FormTextField
        control={control}
        name="departure"
        label="New departure"
        type="date"
        min={addDays(stay.departure, 1)}
        hint="The added nights are priced at the stay's rate plan and charged by night audit."
      />
      {canOverride ? (
        <FormCheckbox
          control={control}
          name="override"
          label="Extend even if the room type is sold out"
        />
      ) : null}
      {override ? (
        <FormTextArea control={control} name="reason" label="Reason" rows={2} required />
      ) : null}
    </FormDialog>
  );
}
