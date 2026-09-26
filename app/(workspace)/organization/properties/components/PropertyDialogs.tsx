"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import {
  useCopyPropertySetupMutation,
  useCreatePropertyMutation,
} from "@/lib/api/endpoints/organization.api";
import { toClientApiError } from "@/lib/api/errors";
import type { PropertySetupCopyResult, PropertyView } from "@/modules/properties/properties.types";

/** A new property: code, identity, zone and currency. Rooms and rates are set up afterwards. */
export function CreatePropertyDialog({ onClose }: { onClose: () => void }) {
  const [create, state] = useCreatePropertyMutation();
  const [form, setForm] = useState({
    code: "",
    name: "",
    timezone: "",
    currencyCode: "",
    countryCode: "",
    confirmationPrefix: "",
    reason: "",
  });
  const error = toClientApiError(state.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });
  return (
    <FormDialog
      title="New property"
      description="The confirmation prefix defaults to the code. The property goes live when its business date is initialized."
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          timezone: form.timezone.trim(),
          currencyCode: form.currencyCode.trim().toUpperCase(),
          countryCode: form.countryCode.trim().toUpperCase(),
          ...(form.confirmationPrefix.trim()
            ? { confirmationPrefix: form.confirmationPrefix.trim().toUpperCase() }
            : {}),
          reason: form.reason.trim(),
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Create property"
      disabled={!form.code || !form.name || form.reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Code"
          value={form.code}
          onChange={set("code")}
          maxLength={10}
          errors={error?.fieldErrors.code}
          hint="2–10 letters or digits"
        />
        <TextField
          label="Name"
          value={form.name}
          onChange={set("name")}
          maxLength={200}
          errors={error?.fieldErrors.name}
        />
        <TextField
          label="Time zone"
          value={form.timezone}
          onChange={set("timezone")}
          placeholder="Asia/Karachi"
          errors={error?.fieldErrors.timezone}
        />
        <TextField
          label="Currency"
          value={form.currencyCode}
          onChange={set("currencyCode")}
          maxLength={3}
          placeholder="PKR"
          errors={error?.fieldErrors.currencyCode}
        />
        <TextField
          label="Country"
          value={form.countryCode}
          onChange={set("countryCode")}
          maxLength={2}
          placeholder="PK"
          errors={error?.fieldErrors.countryCode}
        />
        <TextField
          label="Confirmation prefix (optional)"
          value={form.confirmationPrefix}
          onChange={set("confirmationPrefix")}
          maxLength={10}
          errors={error?.fieldErrors.confirmationPrefix}
        />
      </div>
      <TextArea
        label="Reason (required)"
        value={form.reason}
        onChange={set("reason")}
        maxLength={1000}
        errors={error?.fieldErrors.reason}
      />
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
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [reason, setReason] = useState("");
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
      onSubmit={async () => {
        const response = await copy({ targetId: target.id, sourceId, reason: reason.trim() });
        if ("data" in response && response.data) setResult(response.data);
      }}
      submitLabel="Copy setup"
      disabled={!sourceId || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Select
        label="Copy from"
        value={sourceId}
        onChange={(e) => setSourceId(e.target.value)}
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
      <TextArea
        label="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
        errors={error?.fieldErrors.reason}
      />
    </FormDialog>
  );
}
