"use client";

import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextArea,
  FormTextField,
  FormWeekdayPicker,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import { useRateOptionsQuery, useSetRestrictionsMutation } from "@/global/api/endpoints/ratesApi";
import { toClientApiError } from "@/global/api/errors";
import { RESTRICTION_TYPES } from "@serene/shared/modules/availability/availability.schema";
import {
  type RestrictionFormValues,
  isValuedRestriction,
  restrictionDefaults,
  restrictionFormSchema,
  restrictionPayload,
} from "../_lib/restrictionForm";
import { RESTRICTION_LABELS } from "./RateCalendarPanel";

export function RestrictionDialog({ start, onClose }: { start: string; onClose: () => void }) {
  const property = useProperty();
  const options = useRateOptionsQuery(property.id);
  const [save, state] = useSetRestrictionsMutation();
  const form = useZodForm(restrictionFormSchema, restrictionDefaults(start));
  const { control, handleSubmit, setError, setValue, watch, formState } = form;
  const [action, type] = watch(["action", "type"]);
  const error = toClientApiError(state.error);
  const valued = isValuedRestriction(type);

  async function submit(values: RestrictionFormValues) {
    const result = await save({ propertyId: property.id, body: restrictionPayload(values) });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title="Restrictions"
      description="Applies to every stay date in the range on the chosen weekdays."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={action === "set" ? "Apply" : "Clear"}
      danger={action === "clear"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="action"
          label="Action"
          options={[
            { value: "set", label: "Set" },
            { value: "clear", label: "Clear" },
          ]}
        />
        <FormSelect
          control={control}
          name="type"
          label="Restriction"
          options={RESTRICTION_TYPES.map((t) => ({ value: t, label: RESTRICTION_LABELS[t] ?? t }))}
        />
        <FormTextField control={control} name="from" label="From" type="date" />
        <FormTextField control={control} name="to" label="To" type="date" />
        <FormSelect
          control={control}
          name="roomTypeId"
          label="Room type"
          placeholder="All room types"
          options={(options.data?.roomTypes ?? []).map((rt) => ({ value: rt.id, label: rt.code }))}
        />
        <FormSelect
          control={control}
          name="ratePlanId"
          label="Rate plan"
          placeholder="All rate plans"
          options={(options.data?.ratePlans ?? []).map((p) => ({ value: p.id, label: p.code }))}
        />
        {action === "set" && valued ? (
          <FormTextField
            control={control}
            name="value"
            label={type.includes("ADVANCE") ? "Days" : "Nights"}
            inputMode="numeric"
            onChange={(e) => setValue("value", e.target.value.replace(/\D/g, ""))}
          />
        ) : null}
      </div>
      <FormWeekdayPicker control={control} name="daysOfWeek" />
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={1000} />
    </FormDialog>
  );
}
