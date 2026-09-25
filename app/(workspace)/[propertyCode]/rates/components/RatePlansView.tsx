"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useRatePlansQuery } from "@/lib/api/endpoints/rates.api";
import { toClientApiError } from "@/lib/api/errors";
import type { RatePlanListItem } from "@/modules/rates/rates.types";
import { RatePlanFormDialog } from "./RatePlanForm";

export function derivationLabel(
  plan: Pick<RatePlanListItem, "parent" | "derivation">,
  currency: string,
) {
  if (!plan.parent || !plan.derivation) return "Base plan (own seasons)";
  const value = plan.derivation.value.replace(/\.?0+$/, "");
  const signed = value.startsWith("-") ? value.replace("-", "−") : `+${value}`;
  return plan.derivation.type === "PERCENT"
    ? `${plan.parent.code} ${signed}%`
    : `${plan.parent.code} ${signed} ${currency}`;
}

export function RatePlansView() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const router = useRouter();
  const query = useRatePlansQuery(property.id);
  const error = toClientApiError(query.error);
  const [creating, setCreating] = useState(false);

  if (query.isLoading) return <StatusPanel kind="loading" title="Loading rate plans" />;
  if (error) {
    return (
      <StatusPanel
        kind="error"
        title="Could not load rate plans"
        description={error.message}
        requestId={error.requestId}
      />
    );
  }
  const plans = query.data ?? [];
  return (
    <section className="flex flex-col gap-3">
      {can("rates:manage") ? (
        <div>
          <Button size="touch" onClick={() => setCreating(true)}>
            New rate plan
          </Button>
        </div>
      ) : null}
      {plans.length === 0 ? (
        <StatusPanel kind="empty" title="No rate plans yet" />
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                href={`/${property.code}/rates/${plan.id}` as Route}
                className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-surface-sunken md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {plan.code} · {plan.name}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {plan.kind.toLowerCase().replace("_", " ")}
                  </span>
                </span>
                <span className="text-sm md:order-none">
                  {derivationLabel(plan, plan.currencyCode)}
                </span>
                <span className="col-span-2 text-xs text-fg-muted md:col-span-1">
                  {plan.roomTypes.join(", ")}
                  {plan.seasons > 0 ? ` · ${plan.seasons} seasons` : ""}
                  {plan.packages.length > 0 ? ` · includes ${plan.packages.join(", ")}` : ""}
                </span>
                <span className="col-span-2 flex gap-1 md:col-span-1 md:justify-end">
                  {plan.kind === "GROUP" ? <Badge tone="info">Groups only</Badge> : null}
                  {plan.taxInclusive ? <Badge>Tax incl.</Badge> : null}
                  {plan.status === "ACTIVE" ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge>Inactive</Badge>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <RatePlanFormDialog
          onClose={() => setCreating(false)}
          onSaved={(plan) => router.push(`/${property.code}/rates/${plan.id}` as Route)}
        />
      ) : null}
    </section>
  );
}
