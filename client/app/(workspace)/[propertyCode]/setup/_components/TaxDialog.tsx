"use client";

import { useEffect } from "react";
import { useController } from "react-hook-form";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useBusinessDate } from "@/global/hooks/useBusinessDate";
import { useProperty } from "@/global/hooks/useProperty";
import { useCreateTaxMutation, useUpdateTaxMutation } from "@/global/api/endpoints/setupApi";
import { toClientApiError } from "@/global/api/errors";
import type { PropertySetupView, SetupTaxView } from "@serene/shared/modules/setup/setup.types";
import { type TaxFormValues, taxDefaults, taxFields, taxFormSchema } from "../_lib/setupForm";
import { CheckboxField, FormReasonField, STATUS_OPTIONS } from "./SetupFields";

export function TaxDialog({
  setup,
  tax,
  onClose,
}: {
  setup: PropertySetupView;
  tax: SetupTaxView | null;
  onClose: () => void;
}) {
  const property = useProperty();
  const businessDate = useBusinessDate();
  const [create, created] = useCreateTaxMutation();
  const [update, updated] = useUpdateTaxMutation();
  const state = tax ? updated : created;
  const startDefault =
    businessDate.data?.businessDate ?? businessDate.data?.propertyLocalDate ?? "";
  const form = useZodForm(
    taxFormSchema(tax !== null, startDefault),
    taxDefaults(tax, startDefault),
  );
  const { control, handleSubmit, setError, setValue, getValues, watch, formState } = form;
  const [calculation, effectiveFrom] = watch(["calculation", "effectiveFrom"]);
  const applies = useController({ control, name: "appliesTo" });
  // The business date can arrive after the dialog opens.
  useEffect(() => {
    if (startDefault && !getValues("effectiveFrom")) setValue("effectiveFrom", startDefault);
  }, [startDefault, getValues, setValue]);
  const error = toClientApiError(state.error);
  const toggle = (id: string, on: boolean) =>
    applies.field.onChange(
      on ? [...applies.field.value, id] : applies.field.value.filter((x) => x !== id),
    );

  async function submit(values: TaxFormValues) {
    const fields = taxFields(values, startDefault);
    const result = tax
      ? await update({
          propertyId: property.id,
          taxRuleId: tax.id,
          body: { ...fields, status: values.status },
        })
      : await create({ propertyId: property.id, body: { ...fields, code: values.code.trim() } });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={tax ? `Edit ${tax.code} · ${tax.name}` : "New tax"}
      description="Changes apply to charges posted from now on and to estimates; charges already posted keep their tax. To change a rate from a date, end this tax the day before and add a new one."
      size="lg"
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={tax ? "Save tax" : "Add tax"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <FormTextField
          control={control}
          name="code"
          label="Code"
          maxLength={20}
          disabled={tax !== null}
          hint={tax ? "The code never changes" : "For example GST"}
          onChange={(e) => setValue("code", e.target.value.toUpperCase())}
          required
        />
        <FormTextField
          control={control}
          name="name"
          label="Name (on the guest's folio)"
          maxLength={100}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormSelect
          control={control}
          name="calculation"
          label="Calculated as"
          options={[
            { value: "PERCENT", label: "Percentage of the charge" },
            { value: "FLAT_PER_UNIT", label: `Fixed amount per unit (${property.currencyCode})` },
          ]}
        />
        <FormTextField
          control={control}
          name="rate"
          label={calculation === "PERCENT" ? "Rate (%)" : `Amount (${property.currencyCode})`}
          inputMode="decimal"
          required
        />
        {calculation === "PERCENT" ? (
          <FormSelect
            control={control}
            name="basis"
            label="Base"
            options={[
              { value: "NET", label: "The charge" },
              { value: "COMPOUND", label: "The charge plus earlier taxes" },
            ]}
          />
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField
          control={control}
          name="effectiveFrom"
          label="In force from"
          type="date"
          required
        />
        <FormTextField
          control={control}
          name="effectiveTo"
          label="Until (optional)"
          type="date"
          min={effectiveFrom || undefined}
        />
      </div>
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-sm font-medium text-fg">Added to these charges</legend>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {setup.revenueCodes.map((codeRow) => (
            <CheckboxField
              key={codeRow.id}
              checked={applies.field.value.includes(codeRow.id)}
              onChange={(on) => toggle(codeRow.id, on)}
              hint={codeRow.groupName}
            >
              {codeRow.name}
            </CheckboxField>
          ))}
        </div>
        {applies.fieldState.error?.message ? (
          <p className="text-sm text-danger">{applies.fieldState.error.message}</p>
        ) : null}
      </fieldset>
      {tax ? (
        <FormSelect
          control={control}
          name="status"
          label="Status"
          options={[
            { value: "ACTIVE", label: STATUS_OPTIONS[0]!.label },
            { value: "INACTIVE", label: STATUS_OPTIONS[1]!.label },
          ]}
        />
      ) : null}
      <FormReasonField control={control} />
    </FormDialog>
  );
}
