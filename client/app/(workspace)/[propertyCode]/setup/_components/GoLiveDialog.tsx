"use client";

import { useEffect } from "react";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { FormSelect, applyServerError, useZodForm } from "@/global/components/ui/form";
import { useBusinessDate } from "@/global/hooks/useBusinessDate";
import { useProperty } from "@/global/hooks/useProperty";
import { useInitializeBusinessDateMutation } from "@/global/api/endpoints/setupApi";
import { toClientApiError } from "@/global/api/errors";
import { formatDate } from "@serene/shared/lib/utils/format";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import { goLiveFormSchema, goLivePayload } from "../_lib/setupForm";
import { FormReasonField } from "./SetupFields";

export function GoLiveDialog({ onClose }: { onClose: () => void }) {
  const property = useProperty();
  const businessDate = useBusinessDate();
  const [initialize, state] = useInitializeBusinessDateMutation();
  const today = businessDate.data?.propertyLocalDate ?? null;
  const form = useZodForm(goLiveFormSchema(today), { date: today ?? "", reason: "" });
  const { control, handleSubmit, setError, setValue, getValues, formState } = form;
  // The property's date can arrive after the dialog opens.
  useEffect(() => {
    if (today && !getValues("date")) setValue("date", today);
  }, [today, getValues, setValue]);
  const error = toClientApiError(state.error);
  const options = today
    ? [
        { value: today, label: `${formatDate(today)} (today at the property)` },
        { value: addDays(today, -1), label: `${formatDate(addDays(today, -1))} (yesterday)` },
      ]
    : [];

  async function submit(values: { date: string; reason: string }) {
    const result = await initialize({
      propertyId: property.id,
      body: goLivePayload(values, today),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={`Open the first business date of ${property.name}`}
      description="This can be done once. From then on the night audit closes each business date and opens the next."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Go live"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormSelect
        control={control}
        name="date"
        label="First business date"
        options={options}
        hint="The property's own date, in its time zone."
      />
      <FormReasonField control={control} />
    </FormDialog>
  );
}
