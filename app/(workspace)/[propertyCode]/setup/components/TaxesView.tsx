"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { useProperty } from "@/hooks/useProperty";
import { useCreateTaxMutation, useUpdateTaxMutation } from "@/lib/api/endpoints/setup.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { PropertySetupView, SetupTaxView } from "@/modules/setup/setup.types";
import { CheckboxField, ReasonField, STATUS_OPTIONS } from "./SetupFields";

/** "16.0000" → "16"; "12.5000" → "12.5". */
const trimRate = (rate: string) => rate.replace(/\.?0+$/, "");

/**
 * Taxes added to charges. Billing applies the taxes in force on each
 * posting's business date; posted charges keep the tax they were posted with.
 */
export function TaxesView({ setup, manage }: { setup: PropertySetupView; manage: boolean }) {
  const property = useProperty();
  const [editing, setEditing] = useState<SetupTaxView | "new" | null>(null);
  return (
    <section className="flex flex-col gap-3">
      {manage ? (
        <div>
          <Button onClick={() => setEditing("new")}>New tax</Button>
        </div>
      ) : null}
      {setup.taxes.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="No taxes"
          description="Charges are posted without tax. Add a tax (for example sales tax 16 % on room and restaurant charges) if the property collects one."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {setup.taxes.map((tax) => (
            <li
              key={tax.id}
              className="rounded-lg border border-border-subtle bg-surface p-4 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">
                  {tax.code} · {tax.name}
                </h3>
                <span className="text-sm tabular-nums">
                  {tax.calculation === "PERCENT"
                    ? `${trimRate(tax.rate)} %`
                    : `${formatCurrency(tax.rate, property.currencyCode)} per unit`}
                </span>
                {tax.status === "ACTIVE" ? (
                  <Badge tone="success">In force</Badge>
                ) : (
                  <Badge>Retired</Badge>
                )}
                {manage ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ms-auto"
                    onClick={() => setEditing(tax)}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-fg-secondary">
                From {formatDate(tax.effectiveFrom)}
                {tax.effectiveTo ? ` to ${formatDate(tax.effectiveTo)}` : ""}
                {tax.basis === "COMPOUND" ? " · calculated on the charge plus earlier taxes" : ""}
              </p>
              <p className="mt-1 text-sm">
                Applies to:{" "}
                {tax.appliesTo.length === 0
                  ? "no charges yet"
                  : tax.appliesTo.map((c) => c.name).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <TaxDialog
          setup={setup}
          tax={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function TaxDialog({
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
  const [code, setCode] = useState(tax?.code ?? "");
  const [name, setName] = useState(tax?.name ?? "");
  const [calculation, setCalculation] = useState<"PERCENT" | "FLAT_PER_UNIT">(
    tax?.calculation ?? "PERCENT",
  );
  const [basis, setBasis] = useState<"NET" | "COMPOUND">(tax?.basis ?? "NET");
  const [rate, setRate] = useState(tax ? trimRate(tax.rate) : "");
  const [effectiveFrom, setEffectiveFrom] = useState(tax?.effectiveFrom ?? startDefault);
  const [effectiveTo, setEffectiveTo] = useState(tax?.effectiveTo ?? "");
  const [appliesTo, setAppliesTo] = useState<string[]>(tax?.appliesTo.map((c) => c.id) ?? []);
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(tax?.status ?? "ACTIVE");
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const toggle = (id: string, on: boolean) =>
    setAppliesTo((list) => (on ? [...list, id] : list.filter((x) => x !== id)));
  const fields = {
    name: name.trim(),
    calculation,
    basis,
    rate: rate.trim(),
    effectiveFrom: effectiveFrom || startDefault,
    effectiveTo: effectiveTo || null,
    appliesTo,
    reason: reason.trim(),
  };
  return (
    <FormDialog
      title={tax ? `Edit ${tax.code} · ${tax.name}` : "New tax"}
      description="Changes apply to charges posted from now on and to estimates; charges already posted keep their tax. To change a rate from a date, end this tax the day before and add a new one."
      size="lg"
      onClose={onClose}
      onSubmit={async () => {
        const result = tax
          ? await update({
              propertyId: property.id,
              taxRuleId: tax.id,
              body: { ...fields, status },
            })
          : await create({ propertyId: property.id, body: { ...fields, code: code.trim() } });
        if ("data" in result) onClose();
      }}
      submitLabel={tax ? "Save tax" : "Add tax"}
      disabled={
        !fields.name ||
        !/^\d{1,13}(\.\d{1,4})?$/.test(fields.rate) ||
        !fields.effectiveFrom ||
        fields.reason.length < 3 ||
        (!tax && !code.trim())
      }
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <TextField
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={20}
          disabled={tax !== null}
          hint={tax ? "The code never changes" : "For example GST"}
          errors={error?.fieldErrors.code}
          required
        />
        <TextField
          label="Name (on the guest's folio)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          errors={error?.fieldErrors.name}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Calculated as"
          value={calculation}
          onChange={(e) => setCalculation(e.target.value as "PERCENT" | "FLAT_PER_UNIT")}
          options={[
            { value: "PERCENT", label: "Percentage of the charge" },
            { value: "FLAT_PER_UNIT", label: `Fixed amount per unit (${property.currencyCode})` },
          ]}
        />
        <TextField
          label={calculation === "PERCENT" ? "Rate (%)" : `Amount (${property.currencyCode})`}
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          errors={error?.fieldErrors.rate}
          required
        />
        {calculation === "PERCENT" ? (
          <Select
            label="Base"
            value={basis}
            onChange={(e) => setBasis(e.target.value as "NET" | "COMPOUND")}
            options={[
              { value: "NET", label: "The charge" },
              { value: "COMPOUND", label: "The charge plus earlier taxes" },
            ]}
          />
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="In force from"
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          errors={error?.fieldErrors.effectiveFrom}
          required
        />
        <TextField
          label="Until (optional)"
          type="date"
          value={effectiveTo}
          min={effectiveFrom || undefined}
          onChange={(e) => setEffectiveTo(e.target.value)}
          errors={error?.fieldErrors.effectiveTo}
        />
      </div>
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-sm font-medium text-fg">Added to these charges</legend>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {setup.revenueCodes.map((codeRow) => (
            <CheckboxField
              key={codeRow.id}
              checked={appliesTo.includes(codeRow.id)}
              onChange={(on) => toggle(codeRow.id, on)}
              hint={codeRow.groupName}
            >
              {codeRow.name}
            </CheckboxField>
          ))}
        </div>
        {error?.fieldErrors.appliesTo ? (
          <p className="text-sm text-danger">{error.fieldErrors.appliesTo[0]}</p>
        ) : null}
      </fieldset>
      {tax ? (
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")}
          options={[
            { value: "ACTIVE", label: STATUS_OPTIONS[0]!.label },
            { value: "INACTIVE", label: STATUS_OPTIONS[1]!.label },
          ]}
        />
      ) : null}
      <ReasonField value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}
