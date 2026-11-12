"use client";

import { useFieldArray } from "react-hook-form";
import { Button } from "@/global/components/ui/Button";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormCheckbox,
  FormSelect,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import { useRateOptionsQuery, useSavePackageMutation } from "@/global/api/endpoints/ratesApi";
import { toClientApiError } from "@/global/api/errors";
import {
  PACKAGE_CALCULATIONS,
  PACKAGE_POSTING_TYPES,
  PACKAGE_RHYTHMS,
} from "@serene/shared/modules/rates/rates.schema";
import type { PackageView } from "@serene/shared/modules/rates/rates.types";
import {
  type PackageFormValues,
  emptyPackageComponent,
  packageDefaults,
  packageFormSchema,
  packagePayload,
} from "../_lib/packageForm";

export const POSTING_LABELS: Record<string, string> = {
  INCLUDED_IN_RATE: "Included in the room rate",
  SEPARATE_LINE: "Posted as its own line",
  COMBINED_WITH_ROOM: "Added to the room line",
};
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

export function PackageDialog({ pkg, onClose }: { pkg?: PackageView; onClose: () => void }) {
  const property = useProperty();
  const options = useRateOptionsQuery(property.id);
  const [save, state] = useSavePackageMutation();
  const form = useZodForm(packageFormSchema(Boolean(pkg)), packageDefaults(pkg));
  const { control, handleSubmit, setError, setValue, formState } = form;
  // `id` is a real field of a component (its database id), so the array key is renamed.
  const components = useFieldArray({ control, name: "components", keyName: "_key" });
  const error = toClientApiError(state.error);

  async function submit(values: PackageFormValues) {
    const result = await save({
      propertyId: property.id,
      packageId: pkg?.id,
      body: packagePayload(values, Boolean(pkg)),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={pkg ? `Edit ${pkg.code}` : "New package"}
      description={`Prices in ${property.currencyCode}. Changes apply to nights posted afterwards.`}
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={pkg ? "Save package" : "Create package"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {pkg ? null : (
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
          name="postingType"
          label="Posting"
          options={PACKAGE_POSTING_TYPES.map((t) => ({ value: t, label: POSTING_LABELS[t]! }))}
        />
        {pkg ? (
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
      <FormCheckbox
        control={control}
        name="sellSeparately"
        className="flex min-h-11 items-center gap-2 text-sm"
        label="Can be added to a reservation on its own"
      />
      {components.fields.map((component, index) => (
        <fieldset
          key={component._key}
          className="grid gap-2 rounded-md border border-border-subtle p-3 sm:grid-cols-2"
        >
          <legend className="px-1 text-xs text-fg-secondary">Component {index + 1}</legend>
          <FormTextField control={control} name={`components.${index}.name`} label="Name" />
          <FormSelect
            control={control}
            name={`components.${index}.transactionCodeId`}
            label="Revenue code"
            placeholder="Select"
            options={(options.data?.packageChargeCodes ?? []).map((c) => ({
              value: c.id,
              label: `${c.code} · ${c.name}`,
            }))}
          />
          <FormSelect
            control={control}
            name={`components.${index}.calculation`}
            label="Charged"
            options={PACKAGE_CALCULATIONS.map((c) => ({ value: c, label: label(c) }))}
          />
          <FormSelect
            control={control}
            name={`components.${index}.rhythm`}
            label="When"
            options={PACKAGE_RHYTHMS.filter((r) => r !== "WEEKDAYS").map((r) => ({
              value: r,
              label: label(r),
            }))}
          />
          <FormTextField
            control={control}
            name={`components.${index}.unitPrice`}
            label={`Unit price (${property.currencyCode})`}
            inputMode="decimal"
            onChange={(e) => setValue(`components.${index}.unitPrice`, e.target.value.trim())}
          />
          {components.fields.length > 1 ? (
            <div className="flex items-end">
              <Button variant="ghost" onClick={() => components.remove(index)}>
                Remove component
              </Button>
            </div>
          ) : null}
        </fieldset>
      ))}
      <div>
        <Button variant="secondary" onClick={() => components.append(emptyPackageComponent())}>
          Add component
        </Button>
      </div>
    </FormDialog>
  );
}
