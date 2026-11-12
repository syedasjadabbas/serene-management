"use client";

import { type Control, useController } from "react-hook-form";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useCreateRatePlanMutation,
  useRateOptionsQuery,
  useUpdateRatePlanMutation,
} from "@/global/api/endpoints/ratesApi";
import { toClientApiError } from "@/global/api/errors";
import { RATE_PLAN_KINDS } from "@serene/shared/modules/rates/rates.schema";
import type { RatePlanDetail } from "@serene/shared/modules/rates/rates.types";
import {
  type RatePlanFormValues,
  ratePlanDefaults,
  ratePlanFormSchema,
  ratePlanPayloadFields,
} from "../_lib/ratePlanForm";

function RoomTypeChecks({
  control,
  roomTypes,
}: {
  control: Control<RatePlanFormValues>;
  roomTypes: { id: string; code: string; name: string }[];
}) {
  const { field, fieldState } = useController({ control, name: "roomTypeIds" });
  const ids = field.value;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium text-fg-secondary">Sold for room types</legend>
      <div className="flex flex-wrap gap-x-4">
        {roomTypes.map((rt, index) => (
          <label key={rt.id} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              ref={index === 0 ? field.ref : undefined}
              checked={ids.includes(rt.id)}
              aria-invalid={fieldState.error ? true : undefined}
              onChange={(e) =>
                field.onChange(
                  e.target.checked ? [...ids, rt.id] : ids.filter((id) => id !== rt.id),
                )
              }
            />
            {rt.code} · {rt.name}
          </label>
        ))}
      </div>
      {fieldState.error?.message ? (
        <p className="text-xs text-danger">{fieldState.error.message}</p>
      ) : null}
    </fieldset>
  );
}

/**
 * Create or edit a rate plan. The plan's currency is always the property's
 * (the server sets it); a derived plan takes its prices from its parent, so
 * it has no seasons. `rates:manage` is high-risk: a reason is required.
 */
export function RatePlanFormDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan?: RatePlanDetail;
  onClose: () => void;
  onSaved?: (plan: RatePlanDetail) => void;
}) {
  const property = useProperty();
  const options = useRateOptionsQuery(property.id);
  const [create, createState] = useCreateRatePlanMutation();
  const [update, updateState] = useUpdateRatePlanMutation();
  const form = useZodForm(ratePlanFormSchema(Boolean(plan)), ratePlanDefaults(plan));
  const { control, handleSubmit, setValue, setError, watch, formState } = form;
  const [kind, derived, negotiatedOnly, derivationType, taxInclusive] = watch([
    "kind",
    "derived",
    "negotiatedOnly",
    "derivationType",
    "taxInclusive",
  ]);
  const error = toClientApiError(createState.error ?? updateState.error);
  const o = options.data;
  const ref = (items: { id: string; code: string; name: string }[] | undefined) =>
    (items ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
  const parents = (o?.ratePlans ?? []).filter((p) => p.status === "ACTIVE" && p.id !== plan?.id);

  const submit = async (values: RatePlanFormValues) => {
    const fields = ratePlanPayloadFields(values, plan?.displayOrder);
    const result = plan
      ? await update({
          propertyId: property.id,
          ratePlanId: plan.id,
          body: { ...fields, version: plan.version, status: values.status },
        })
      : await create({ propertyId: property.id, body: { ...fields, code: values.code.trim() } });
    if ("data" in result && result.data) {
      onSaved?.(result.data);
      onClose();
    } else if ("error" in result) {
      applyServerError(setError, toClientApiError(result.error));
    }
  };

  return (
    <FormDialog
      title={plan ? `Edit ${plan.code}` : "New rate plan"}
      description={`Prices are in ${property.currencyCode}. Changes are audited with your reason.`}
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={plan ? "Save changes" : "Create rate plan"}
      pending={createState.isLoading || updateState.isLoading || formState.isSubmitting}
      error={error}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {plan ? null : (
          <FormTextField
            control={control}
            name="code"
            label="Code"
            maxLength={20}
            onChange={(e) => setValue("code", e.target.value.toUpperCase())}
          />
        )}
        <FormTextField control={control} name="name" label="Name" maxLength={100} />
        <FormSelect
          control={control}
          name="kind"
          label="Kind"
          options={RATE_PLAN_KINDS.map((k) => ({
            value: k,
            label: k.replace("_", " ").toLowerCase(),
          }))}
        />
        <FormSelect
          control={control}
          name="roomTransactionCodeId"
          label="Room revenue code"
          placeholder="Select"
          options={ref(o?.roomChargeCodes)}
        />
        {plan ? (
          <FormSelect
            control={control}
            name="status"
            label="Status"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
          />
        ) : null}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={taxInclusive}
          onChange={(e) => setValue("taxInclusive", e.target.checked)}
        />
        Prices include taxes
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={negotiatedOnly || kind === "NEGOTIATED"}
          disabled={kind === "NEGOTIATED"}
          onChange={(e) => setValue("negotiatedOnly", e.target.checked)}
        />
        Sold only to linked companies (negotiated rate, never public)
      </label>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
        <legend className="px-1 text-xs text-fg-secondary">Pricing</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="pricing-mode"
              checked={!derived}
              onChange={() => setValue("derived", false)}
            />
            Own seasons (base plan)
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="pricing-mode"
              checked={derived}
              onChange={() => setValue("derived", true)}
            />
            Derived from another plan
          </label>
        </div>
        {derived ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <FormSelect
              control={control}
              name="parentId"
              label="Parent plan"
              placeholder="Select"
              options={parents.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
              className="sm:col-span-2"
            />
            <FormSelect
              control={control}
              name="derivationType"
              label="Adjustment"
              options={[
                { value: "PERCENT", label: "Percent" },
                { value: "AMOUNT", label: `Amount (${property.currencyCode})` },
              ]}
            />
            <FormTextField
              control={control}
              name="derivationValue"
              label={derivationType === "PERCENT" ? "Percent (±)" : "Amount (±)"}
              inputMode="decimal"
              onChange={(e) => setValue("derivationValue", e.target.value.trim())}
            />
            <FormTextField
              control={control}
              name="rounding"
              label="Round to"
              hint="e.g. 1 = whole units"
              inputMode="decimal"
              onChange={(e) => setValue("rounding", e.target.value.trim())}
            />
          </div>
        ) : (
          <p className="text-xs text-fg-muted">
            Add seasons with prices on the plan page after saving.
          </p>
        )}
      </fieldset>

      <RoomTypeChecks control={control} roomTypes={o?.roomTypes ?? []} />

      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="cancellationPolicyId"
          label="Cancellation policy"
          placeholder="None"
          options={ref(o?.cancellationPolicies)}
        />
        <FormSelect
          control={control}
          name="marketId"
          label="Default market"
          placeholder="None"
          options={ref(o?.marketCodes)}
        />
        <FormSelect
          control={control}
          name="sourceId"
          label="Default source"
          placeholder="None"
          options={ref(o?.sourceCodes)}
        />
        <div className="grid grid-cols-2 gap-2">
          <FormTextField control={control} name="stayFrom" label="Stay from" type="date" />
          <FormTextField control={control} name="stayTo" label="Stay to" type="date" />
        </div>
      </div>
      <FormTextArea
        control={control}
        name="description"
        label="Description (optional)"
        maxLength={2000}
      />
      <FormTextArea
        control={control}
        name="reason"
        label="Reason for the change (audited)"
        maxLength={1000}
      />
    </FormDialog>
  );
}
