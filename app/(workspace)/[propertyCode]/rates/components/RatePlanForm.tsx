"use client";

import { useState } from "react";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import {
  useCreateRatePlanMutation,
  useRateOptionsQuery,
  useUpdateRatePlanMutation,
} from "@/lib/api/endpoints/rates.api";
import { toClientApiError } from "@/lib/api/errors";
import { RATE_PLAN_KINDS } from "@/modules/rates/rates.schema";
import type { RatePlanDetail } from "@/modules/rates/rates.types";

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
  const [code, setCode] = useState("");
  const [name, setName] = useState(plan?.name ?? "");
  const [kind, setKind] = useState(plan?.kind ?? "CORPORATE");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [taxInclusive, setTaxInclusive] = useState(plan?.taxInclusive ?? false);
  const [negotiatedOnly, setNegotiatedOnly] = useState(plan?.requiresNegotiation ?? false);
  const [roomCodeId, setRoomCodeId] = useState(plan?.roomTransactionCode.id ?? "");
  const [derived, setDerived] = useState(plan ? plan.derivation !== null : true);
  const [parentId, setParentId] = useState(plan?.derivation?.parentRatePlanId ?? "");
  const [derivationType, setDerivationType] = useState<"PERCENT" | "AMOUNT">(
    plan?.derivation?.type ?? "PERCENT",
  );
  const [derivationValue, setDerivationValue] = useState(plan?.derivation?.value ?? "-10");
  const [rounding, setRounding] = useState(plan?.derivation?.roundingIncrement ?? "1");
  const [roomTypeIds, setRoomTypeIds] = useState<string[]>(plan?.roomTypeIds ?? []);
  const [cancellationPolicyId, setCancellationPolicyId] = useState(
    plan?.cancellationPolicyId ?? "",
  );
  const [marketId, setMarketId] = useState(plan?.defaultMarketCodeId ?? "");
  const [sourceId, setSourceId] = useState(plan?.defaultSourceCodeId ?? "");
  const [stayFrom, setStayFrom] = useState(plan?.stayFrom ?? "");
  const [stayTo, setStayTo] = useState(plan?.stayTo ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(plan?.status ?? "ACTIVE");
  const [reason, setReason] = useState("");
  const error = toClientApiError(createState.error ?? updateState.error);
  const o = options.data;
  const ref = (items: { id: string; code: string; name: string }[] | undefined) =>
    (items ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
  const parents = (o?.ratePlans ?? []).filter((p) => p.status === "ACTIVE" && p.id !== plan?.id);

  const fields = {
    name: name.trim(),
    description: description.trim() || null,
    kind: kind as (typeof RATE_PLAN_KINDS)[number],
    taxInclusive,
    // A NEGOTIATED plan is always sold only to its companies (server-enforced too).
    requiresNegotiation: negotiatedOnly || kind === "NEGOTIATED",
    roomTransactionCodeId: roomCodeId,
    derivation: derived
      ? {
          parentRatePlanId: parentId,
          type: derivationType,
          value: derivationValue.trim(),
          roundingIncrement: rounding.trim() || null,
        }
      : null,
    stayFrom: stayFrom || null,
    stayTo: stayTo || null,
    cancellationPolicyId: cancellationPolicyId || null,
    defaultMarketCodeId: marketId || null,
    defaultSourceCodeId: sourceId || null,
    displayOrder: plan?.displayOrder ?? 10,
    roomTypeIds,
    reason: reason.trim(),
  };
  const valid =
    fields.name.length > 0 &&
    !!roomCodeId &&
    roomTypeIds.length > 0 &&
    (!derived || !!parentId) &&
    (plan || code.trim().length > 0) &&
    fields.reason.length >= 3;

  const submit = async () => {
    const result = plan
      ? await update({
          propertyId: property.id,
          ratePlanId: plan.id,
          body: { ...fields, version: plan.version, status },
        })
      : await create({ propertyId: property.id, body: { ...fields, code: code.trim() } });
    if ("data" in result && result.data) {
      onSaved?.(result.data);
      onClose();
    }
  };

  return (
    <FormDialog
      title={plan ? `Edit ${plan.code}` : "New rate plan"}
      description={`Prices are in ${property.currencyCode}. Changes are audited with your reason.`}
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel={plan ? "Save changes" : "Create rate plan"}
      disabled={!valid}
      pending={createState.isLoading || updateState.isLoading}
      error={error}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {plan ? null : (
          <TextField
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={20}
            errors={error?.fieldErrors.code}
          />
        )}
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
        <Select
          label="Kind"
          options={RATE_PLAN_KINDS.map((k) => ({
            value: k,
            label: k.replace("_", " ").toLowerCase(),
          }))}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        />
        <Select
          label="Room revenue code"
          placeholder="Select"
          options={ref(o?.roomChargeCodes)}
          value={roomCodeId}
          onChange={(e) => setRoomCodeId(e.target.value)}
          errors={error?.fieldErrors.roomTransactionCodeId}
        />
        {plan ? (
          <Select
            label="Status"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
            value={status}
            onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")}
          />
        ) : null}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={taxInclusive}
          onChange={(e) => setTaxInclusive(e.target.checked)}
        />
        Prices include taxes
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={negotiatedOnly || kind === "NEGOTIATED"}
          disabled={kind === "NEGOTIATED"}
          onChange={(e) => setNegotiatedOnly(e.target.checked)}
        />
        Sold only to linked companies (negotiated rate, never public)
      </label>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
        <legend className="px-1 text-xs text-fg-secondary">Pricing</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" checked={!derived} onChange={() => setDerived(false)} />
            Own seasons (base plan)
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" checked={derived} onChange={() => setDerived(true)} />
            Derived from another plan
          </label>
        </div>
        {derived ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <Select
              label="Parent plan"
              placeholder="Select"
              options={parents.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="sm:col-span-2"
            />
            <Select
              label="Adjustment"
              options={[
                { value: "PERCENT", label: "Percent" },
                { value: "AMOUNT", label: `Amount (${property.currencyCode})` },
              ]}
              value={derivationType}
              onChange={(e) => setDerivationType(e.target.value as "PERCENT" | "AMOUNT")}
            />
            <TextField
              label={derivationType === "PERCENT" ? "Percent (±)" : "Amount (±)"}
              value={derivationValue}
              onChange={(e) => setDerivationValue(e.target.value.trim())}
              inputMode="decimal"
            />
            <TextField
              label="Round to"
              hint="e.g. 1 = whole units"
              value={rounding}
              onChange={(e) => setRounding(e.target.value.trim())}
              inputMode="decimal"
            />
          </div>
        ) : (
          <p className="text-xs text-fg-muted">
            Add seasons with prices on the plan page after saving.
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium text-fg-secondary">Sold for room types</legend>
        <div className="flex flex-wrap gap-x-4">
          {(o?.roomTypes ?? []).map((rt) => (
            <label key={rt.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={roomTypeIds.includes(rt.id)}
                onChange={(e) =>
                  setRoomTypeIds((ids) =>
                    e.target.checked ? [...ids, rt.id] : ids.filter((id) => id !== rt.id),
                  )
                }
              />
              {rt.code} · {rt.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Cancellation policy"
          placeholder="None"
          options={ref(o?.cancellationPolicies)}
          value={cancellationPolicyId}
          onChange={(e) => setCancellationPolicyId(e.target.value)}
        />
        <Select
          label="Default market"
          placeholder="None"
          options={ref(o?.marketCodes)}
          value={marketId}
          onChange={(e) => setMarketId(e.target.value)}
        />
        <Select
          label="Default source"
          placeholder="None"
          options={ref(o?.sourceCodes)}
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Stay from"
            type="date"
            value={stayFrom}
            onChange={(e) => setStayFrom(e.target.value)}
          />
          <TextField
            label="Stay to"
            type="date"
            value={stayTo}
            onChange={(e) => setStayTo(e.target.value)}
          />
        </div>
      </div>
      <TextArea
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
      />
      <TextArea
        label="Reason for the change (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
        errors={error?.fieldErrors.reason}
      />
    </FormDialog>
  );
}
