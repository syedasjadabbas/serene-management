"use client";

import { useState } from "react";
import { useController, useFieldArray } from "react-hook-form";
import { type PickedCompany, CompanyPicker } from "@/global/components/accounts/CompanyPicker";
import { Button } from "@/global/components/ui/Button";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormTextArea,
  FormTextField,
  FormWeekdayPicker,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useDeleteSeasonMutation,
  usePackagesQuery,
  useRateOptionsQuery,
  useSaveSeasonMutation,
  useSetPlanAccountsMutation,
  useSetPlanPackagesMutation,
} from "@/global/api/endpoints/ratesApi";
import { toClientApiError } from "@/global/api/errors";
import type { RatePlanDetail, SeasonView } from "@serene/shared/modules/rates/rates.types";
import {
  type PlanAccountsValues,
  type PlanPackagesValues,
  type ReasonOnlyValues,
  type SeasonFormValues,
  planAccountsBody,
  planAccountsDefaults,
  planAccountsFormSchema,
  planPackagesFormSchema,
  reasonOnlyFormSchema,
  seasonBody,
  seasonDefaults,
  seasonFormSchema,
} from "../_lib/planDialogForms";

const REASON_LABEL = "Reason (audited)";

export function SeasonDialog({
  plan,
  season,
  onClose,
}: {
  plan: RatePlanDetail;
  season?: SeasonView;
  onClose: () => void;
}) {
  const property = useProperty();
  const options = useRateOptionsQuery(property.id);
  const [save, state] = useSaveSeasonMutation();
  const types = (options.data?.roomTypes ?? []).filter((rt) => plan.roomTypeIds.includes(rt.id));
  const typeIds = types.map((rt) => rt.id);
  const form = useZodForm(
    seasonFormSchema(typeIds),
    seasonDefaults(season, options.data?.businessDate ?? ""),
  );
  const { control, handleSubmit, setError, setValue, formState } = form;
  const pricesError = (formState.errors.prices as { message?: string } | undefined)?.message;
  const error = toClientApiError(state.error);

  async function submit(values: SeasonFormValues) {
    const result = await save({
      propertyId: property.id,
      ratePlanId: plan.id,
      seasonId: season?.id,
      body: seasonBody(values, typeIds, plan.version),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={season ? `Edit season · ${season.name}` : "New season"}
      description="The highest-priority season covering a night and weekday sets its price; equal priorities may not overlap."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Save season"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <FormTextField control={control} name="name" label="Name" className="sm:col-span-2" />
        <FormTextField control={control} name="startDate" label="First night" type="date" />
        <FormTextField control={control} name="endDate" label="Last night" type="date" />
        <FormTextField
          control={control}
          name="priority"
          label="Priority"
          inputMode="numeric"
          onChange={(e) => setValue("priority", e.target.value.replace(/\D/g, ""))}
        />
      </div>
      <FormWeekdayPicker control={control} name="daysOfWeek" />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-fg-secondary">
          Prices ({plan.currencyCode})
        </legend>
        {types.map((rt) => (
          <div
            key={rt.id}
            className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2"
          >
            <span className="pb-2 text-sm font-medium">{rt.code}</span>
            <FormTextField
              control={control}
              name={`prices.${rt.id}.one`}
              label="1 adult"
              inputMode="decimal"
              onChange={(e) => setValue(`prices.${rt.id}.one`, e.target.value.trim())}
            />
            <FormTextField
              control={control}
              name={`prices.${rt.id}.two`}
              label="2 adults"
              inputMode="decimal"
              onChange={(e) => setValue(`prices.${rt.id}.two`, e.target.value.trim())}
            />
          </div>
        ))}
        {pricesError ? <p className="text-xs text-danger">{pricesError}</p> : null}
      </fieldset>
      <FormTextArea control={control} name="reason" label={REASON_LABEL} maxLength={1000} />
    </FormDialog>
  );
}

export function RemoveSeasonDialog({
  plan,
  season,
  onClose,
}: {
  plan: RatePlanDetail;
  season: SeasonView;
  onClose: () => void;
}) {
  const property = useProperty();
  const [remove, state] = useDeleteSeasonMutation();
  const form = useZodForm(reasonOnlyFormSchema, { reason: "" });
  const { control, handleSubmit, setError, formState } = form;

  async function submit(values: ReasonOnlyValues) {
    const result = await remove({
      propertyId: property.id,
      ratePlanId: plan.id,
      seasonId: season.id,
      body: { version: plan.version, reason: values.reason.trim() },
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={`Delete season · ${season.name}`}
      description="Nights it priced fall back to the next season (or become unpriced). Booked reservations keep their prices."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Delete season"
      danger
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <FormTextArea control={control} name="reason" label={REASON_LABEL} maxLength={1000} />
    </FormDialog>
  );
}

export function PlanPackagesDialog({
  plan,
  onClose,
}: {
  plan: RatePlanDetail;
  onClose: () => void;
}) {
  const property = useProperty();
  const packages = usePackagesQuery(property.id);
  const [save, state] = useSetPlanPackagesMutation();
  const form = useZodForm(planPackagesFormSchema, {
    packageIds: plan.packages.map((p) => p.id),
    reason: "",
  });
  const { control, handleSubmit, setError, formState } = form;
  const ids = useController({ control, name: "packageIds" }).field;

  async function submit(values: PlanPackagesValues) {
    const result = await save({
      propertyId: property.id,
      ratePlanId: plan.id,
      body: { version: plan.version, packageIds: values.packageIds, reason: values.reason.trim() },
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={`Packages in ${plan.code}`}
      description="Included packages are carved out of the room rate when nights are posted."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Save packages"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      {(packages.data ?? [])
        .filter((p) => p.status === "ACTIVE")
        .map((p) => (
          <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ids.value.includes(p.id)}
              onChange={(e) =>
                ids.onChange(
                  e.target.checked ? [...ids.value, p.id] : ids.value.filter((id) => id !== p.id),
                )
              }
            />
            {p.code} · {p.name}
          </label>
        ))}
      <FormTextArea control={control} name="reason" label={REASON_LABEL} maxLength={1000} />
    </FormDialog>
  );
}

export function PlanAccountsDialog({
  plan,
  onClose,
}: {
  plan: RatePlanDetail;
  onClose: () => void;
}) {
  const property = useProperty();
  const [save, state] = useSetPlanAccountsMutation();
  const form = useZodForm(planAccountsFormSchema, planAccountsDefaults(plan));
  const { control, handleSubmit, setError, formState } = form;
  const rows = useFieldArray({ control, name: "rows", keyName: "_key" });
  const [adding, setAdding] = useState<PickedCompany | null>(null);

  async function submit(values: PlanAccountsValues) {
    const result = await save({
      propertyId: property.id,
      ratePlanId: plan.id,
      body: planAccountsBody(values, plan.version),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={`Companies for ${plan.code}`}
      description="Only these companies see and book this plan, for stays inside their window."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Save companies"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
      size="lg"
    >
      {rows.fields.map((r, index) => (
        <div
          key={r.company.id}
          className="grid items-end gap-2 border-b border-border-subtle pb-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]"
        >
          <p className="min-h-11 content-center text-sm font-medium">{r.company.label}</p>
          <FormTextField
            control={control}
            name={`rows.${index}.validFrom`}
            label="From"
            type="date"
          />
          <FormTextField control={control} name={`rows.${index}.validTo`} label="To" type="date" />
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 md:min-h-0"
            onClick={() => rows.remove(index)}
          >
            Remove
          </Button>
        </div>
      ))}
      <CompanyPicker
        value={adding}
        onChange={(company) => {
          if (company && !rows.fields.some((r) => r.company.id === company.id)) {
            rows.append({ company, validFrom: "", validTo: "" });
          }
          setAdding(null);
        }}
        label="Add a company"
      />
      <FormTextArea control={control} name="reason" label={REASON_LABEL} maxLength={1000} />
    </FormDialog>
  );
}
