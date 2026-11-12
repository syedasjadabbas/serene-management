"use client";

import { useState } from "react";
import { Badge } from "@/global/components/ui/Badge";
import { Button } from "@/global/components/ui/Button";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";
import { usePackagesQuery, useRateOptionsQuery } from "@/global/api/endpoints/ratesApi";
import { toClientApiError } from "@/global/api/errors";
import { formatCurrency } from "@serene/shared/lib/utils/format";
import type { PackageView } from "@serene/shared/modules/rates/rates.types";
import { POSTING_LABELS, PackageDialog } from "./PackageDialog";

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
          <Button onClick={() => setEditing("new")}>New package</Button>
        </div>
      ) : null}
      {(query.data ?? []).length === 0 ? (
        <StatusPanel kind="empty" title="No packages yet" />
      ) : null}
      <ul className="flex flex-col gap-2">
        {(query.data ?? []).map((pkg) => (
          <li
            key={pkg.id}
            className="rounded-lg border border-border-subtle bg-surface p-4 shadow-card"
          >
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
