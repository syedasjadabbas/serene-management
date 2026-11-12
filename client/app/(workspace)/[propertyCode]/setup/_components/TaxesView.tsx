"use client";

import { useState } from "react";
import { Badge } from "@/global/components/ui/Badge";
import { Button } from "@/global/components/ui/Button";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { useProperty } from "@/global/hooks/useProperty";
import { formatCurrency, formatDate } from "@serene/shared/lib/utils/format";
import type { PropertySetupView, SetupTaxView } from "@serene/shared/modules/setup/setup.types";
import { trimRate } from "../_lib/setupForm";
import { TaxDialog } from "./TaxDialog";

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
