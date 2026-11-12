"use client";

import { useState } from "react";
import { Alert } from "@/global/components/ui/Alert";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import {
  useCopyPropertySetupMutation,
  useCreatePropertyMutation,
} from "@/global/api/endpoints/organizationApi";
import { toClientApiError } from "@/global/api/errors";
import {
  copySetupDefaults,
  copySetupFormSchema,
  createPropertyDefaults,
  createPropertyFormSchema,
  toCreatePropertyBody,
} from "../_lib/propertyForms";
import type {
  PropertySetupCopyResult,
  PropertyView,
} from "@serene/shared/modules/properties/properties.types";

/** A new property: code, identity, zone and currency. Rooms and rates are set up afterwards. */
export function CreatePropertyDialog({ onClose }: { onClose: () => void }) {
  const [create, state] = useCreatePropertyMutation();
  const { control, handleSubmit, setError, formState } = useZodForm(
    createPropertyFormSchema,
    createPropertyDefaults,
  );
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title="New property"
      description="The confirmation prefix defaults to the code. The property goes live when its business date is initialized."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await create(toCreatePropertyBody(values));
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Create property"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField
          control={control}
          name="code"
          label="Code"
          maxLength={10}
          hint="2–10 letters or digits"
        />
        <FormTextField control={control} name="name" label="Name" maxLength={200} />
        <FormTextField
          control={control}
          name="timezone"
          label="Time zone"
          placeholder="Asia/Karachi"
        />
        <FormTextField
          control={control}
          name="currencyCode"
          label="Currency"
          maxLength={3}
          placeholder="PKR"
        />
        <FormTextField
          control={control}
          name="countryCode"
          label="Country"
          maxLength={2}
          placeholder="PK"
        />
        <FormTextField
          control={control}
          name="confirmationPrefix"
          label="Confirmation prefix (optional)"
          maxLength={10}
        />
      </div>
      <FormTextArea control={control} name="reason" label="Reason (required)" maxLength={1000} />
    </FormDialog>
  );
}

/**
 * Copies reference setup (codes, taxes, payment methods, policies…) from
 * another property into one that is not live yet. Idempotent: codes the
 * target already has are kept.
 */
export function CopySetupDialog({
  target,
  sources,
  onClose,
}: {
  target: PropertyView;
  sources: PropertyView[];
  onClose: () => void;
}) {
  const [copy, state] = useCopyPropertySetupMutation();
  const { control, handleSubmit, setError, watch, formState } = useZodForm(
    copySetupFormSchema,
    copySetupDefaults(sources[0]?.id ?? ""),
  );
  const sourceId = watch("sourceId");
  const [result, setResult] = useState<PropertySetupCopyResult | null>(null);
  const error = toClientApiError(state.error);
  const source = sources.find((s) => s.id === sourceId);

  if (result) {
    return (
      <FormDialog
        title={`Setup copied into ${result.targetProperty.code}`}
        onClose={onClose}
        onSubmit={onClose}
        submitLabel="Done"
        pending={false}
        error={null}
        size="lg"
      >
        <p className="text-sm">
          {result.copied} copied, {result.skipped} already present or skipped, from{" "}
          {result.sourceProperty.code}.
        </p>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">What was copied</caption>
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="py-1 pe-3 font-medium">
                  Kind
                </th>
                <th scope="col" className="py-1 pe-3 text-right font-medium">
                  Copied
                </th>
                <th scope="col" className="py-1 pe-3 text-right font-medium">
                  Skipped
                </th>
                <th scope="col" className="py-1 font-medium">
                  Review
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {result.sections.map((s) => (
                <tr key={s.key}>
                  <th scope="row" className="py-1 pe-3 text-left font-normal">
                    {s.label}
                  </th>
                  <td className="py-1 pe-3 text-right tabular-nums">{s.copied}</td>
                  <td className="py-1 pe-3 text-right tabular-nums">{s.skipped}</td>
                  <td className="py-1 font-mono text-xs">{s.needsReview.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      title={`Copy setup into ${target.code}`}
      description="Copies charge and payment codes, taxes, reason, market, source and channel codes, housekeeping task types, block statuses, reservation types and cancellation and deposit policies. Rooms, room types, rates, reservations and history are never copied."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const response = await copy({ targetId: target.id, ...values });
        if ("data" in response && response.data) setResult(response.data);
        else applyServerError(setError, toClientApiError(response.error));
      })}
      submitLabel="Copy setup"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormSelect
        control={control}
        name="sourceId"
        label="Copy from"
        options={sources.map((s) => ({
          value: s.id,
          label: `${s.code} · ${s.name} (${s.currencyCode})`,
        }))}
      />
      {source && source.currencyCode !== target.currencyCode ? (
        <Alert tone="warning">
          {source.code} uses {source.currencyCode} and {target.code} uses {target.currencyCode}:
          amounts are not converted, so fixed prices, flat taxes and flat policies are left for
          review.
        </Alert>
      ) : null}
      <FormTextArea control={control} name="reason" label="Reason (required)" maxLength={1000} />
    </FormDialog>
  );
}
