"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  usePackagesQuery,
  useRateOptionsQuery,
  useSavePackageMutation,
} from "@/lib/api/endpoints/rates.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency } from "@/lib/utils/format";
import {
  PACKAGE_CALCULATIONS,
  PACKAGE_POSTING_TYPES,
  PACKAGE_RHYTHMS,
} from "@/modules/rates/rates.schema";
import type { PackageView } from "@/modules/rates/rates.types";

const POSTING_LABELS: Record<string, string> = {
  INCLUDED_IN_RATE: "Included in the room rate",
  SEPARATE_LINE: "Posted as its own line",
  COMBINED_WITH_ROOM: "Added to the room line",
};
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

/** Package configuration; pricing and posting are done by billing from these rows. */
export function PackagesView() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const query = usePackagesQuery(property.id);
  const options = useRateOptionsQuery(property.id);
  const error = toClientApiError(query.error);
  const [editing, setEditing] = useState<PackageView | "new" | null>(null);

  if (query.isLoading) return <StatusPanel kind="loading" title="Loading packages" />;
  if (error)
    return <StatusPanel kind="error" title="Could not load packages" description={error.message} />;
  const money = (value: string) =>
    formatCurrency(value, property.currencyCode, "en", options.data?.minorUnits);
  return (
    <section className="flex flex-col gap-3">
      {can("packages:manage") ? (
        <div>
          <Button size="touch" onClick={() => setEditing("new")}>
            New package
          </Button>
        </div>
      ) : null}
      {(query.data ?? []).length === 0 ? (
        <StatusPanel kind="empty" title="No packages yet" />
      ) : null}
      <ul className="flex flex-col gap-2">
        {(query.data ?? []).map((pkg) => (
          <li key={pkg.id} className="rounded-lg border border-border-subtle bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">
                {pkg.code} · {pkg.name}
              </h2>
              {pkg.status === "ACTIVE" ? (
                <Badge tone="success">Active</Badge>
              ) : (
                <Badge>Inactive</Badge>
              )}
              {pkg.sellSeparately ? <Badge tone="info">Sold separately</Badge> : null}
              {can("packages:manage") ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="ms-auto min-h-11 md:min-h-0"
                  onClick={() => setEditing(pkg)}
                >
                  Edit
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-fg-secondary">
              {POSTING_LABELS[pkg.postingType]}
              {pkg.ratePlans.length > 0 ? ` · in rate plans ${pkg.ratePlans.join(", ")}` : ""}
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {pkg.components.map((c) => (
                <li key={c.id}>
                  {c.name} · {money(c.unitPrice)} {label(c.calculation)}, {label(c.rhythm)} · code{" "}
                  {c.transactionCode.code}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {editing ? (
        <PackageDialog
          pkg={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

type ComponentDraft = {
  id?: string;
  name: string;
  transactionCodeId: string;
  calculation: (typeof PACKAGE_CALCULATIONS)[number];
  rhythm: (typeof PACKAGE_RHYTHMS)[number];
  unitPrice: string;
};

function PackageDialog({ pkg, onClose }: { pkg?: PackageView; onClose: () => void }) {
  const property = useProperty();
  const options = useRateOptionsQuery(property.id);
  const [save, state] = useSavePackageMutation();
  const [code, setCode] = useState("");
  const [name, setName] = useState(pkg?.name ?? "");
  const [postingType, setPostingType] = useState(pkg?.postingType ?? "SEPARATE_LINE");
  const [sellSeparately, setSellSeparately] = useState(pkg?.sellSeparately ?? true);
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(pkg?.status ?? "ACTIVE");
  const [components, setComponents] = useState<ComponentDraft[]>(
    pkg?.components.map((c) => ({
      id: c.id,
      name: c.name,
      transactionCodeId: c.transactionCode.id,
      calculation: c.calculation as ComponentDraft["calculation"],
      rhythm: c.rhythm as ComponentDraft["rhythm"],
      unitPrice: c.unitPrice,
    })) ?? [
      {
        name: "",
        transactionCodeId: "",
        calculation: "PER_ROOM",
        rhythm: "EVERY_NIGHT",
        unitPrice: "",
      },
    ],
  );
  const error = toClientApiError(state.error);
  const patch = (index: number, change: Partial<ComponentDraft>) =>
    setComponents((list) => list.map((c, i) => (i === index ? { ...c, ...change } : c)));
  const valid =
    name.trim().length > 0 &&
    (pkg || code.trim().length > 0) &&
    components.every(
      (c) => c.name.trim() && c.transactionCodeId && /^\d+(\.\d+)?$/.test(c.unitPrice),
    );

  return (
    <FormDialog
      title={pkg ? `Edit ${pkg.code}` : "New package"}
      description={`Prices in ${property.currencyCode}. Changes apply to nights posted afterwards.`}
      onClose={onClose}
      onSubmit={async () => {
        const base = {
          name: name.trim(),
          postingType,
          sellSeparately,
          components: components.map((c) => ({ ...c, name: c.name.trim(), daysOfWeek: 127 })),
        };
        const result = await save({
          propertyId: property.id,
          packageId: pkg?.id,
          body: pkg ? { ...base, status } : { ...base, code: code.trim() },
        });
        if ("data" in result) onClose();
      }}
      submitLabel={pkg ? "Save package" : "Create package"}
      disabled={!valid}
      pending={state.isLoading}
      error={error}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {pkg ? null : (
          <TextField
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={20}
          />
        )}
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
        <Select
          label="Posting"
          options={PACKAGE_POSTING_TYPES.map((t) => ({ value: t, label: POSTING_LABELS[t]! }))}
          value={postingType}
          onChange={(e) => setPostingType(e.target.value as typeof postingType)}
        />
        {pkg ? (
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
          checked={sellSeparately}
          onChange={(e) => setSellSeparately(e.target.checked)}
        />
        Can be added to a reservation on its own
      </label>
      {components.map((component, index) => (
        <fieldset
          key={component.id ?? index}
          className="grid gap-2 rounded-md border border-border-subtle p-3 sm:grid-cols-2"
        >
          <legend className="px-1 text-xs text-fg-secondary">Component {index + 1}</legend>
          <TextField
            label="Name"
            value={component.name}
            onChange={(e) => patch(index, { name: e.target.value })}
          />
          <Select
            label="Revenue code"
            placeholder="Select"
            options={(options.data?.packageChargeCodes ?? []).map((c) => ({
              value: c.id,
              label: `${c.code} · ${c.name}`,
            }))}
            value={component.transactionCodeId}
            onChange={(e) => patch(index, { transactionCodeId: e.target.value })}
          />
          <Select
            label="Charged"
            options={PACKAGE_CALCULATIONS.map((c) => ({ value: c, label: label(c) }))}
            value={component.calculation}
            onChange={(e) =>
              patch(index, { calculation: e.target.value as ComponentDraft["calculation"] })
            }
          />
          <Select
            label="When"
            options={PACKAGE_RHYTHMS.filter((r) => r !== "WEEKDAYS").map((r) => ({
              value: r,
              label: label(r),
            }))}
            value={component.rhythm}
            onChange={(e) => patch(index, { rhythm: e.target.value as ComponentDraft["rhythm"] })}
          />
          <TextField
            label={`Unit price (${property.currencyCode})`}
            inputMode="decimal"
            value={component.unitPrice}
            onChange={(e) => patch(index, { unitPrice: e.target.value.trim() })}
            errors={error?.fieldErrors[`components.${index}.unitPrice`]}
          />
          {components.length > 1 ? (
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={() => setComponents((list) => list.filter((_, i) => i !== index))}
              >
                Remove component
              </Button>
            </div>
          ) : null}
        </fieldset>
      ))}
      <div>
        <Button
          variant="secondary"
          onClick={() =>
            setComponents((list) => [
              ...list,
              {
                name: "",
                transactionCodeId: "",
                calculation: "PER_ROOM",
                rhythm: "EVERY_NIGHT",
                unitPrice: "",
              },
            ])
          }
        >
          Add component
        </Button>
      </div>
    </FormDialog>
  );
}
