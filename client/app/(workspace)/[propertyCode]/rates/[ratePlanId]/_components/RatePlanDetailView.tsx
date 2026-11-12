"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge } from "@/global/components/ui/Badge";
import { Tags } from "lucide-react";
import { Button } from "@/global/components/ui/Button";
import { PageHeader } from "@/global/components/ui/PageHeader";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";
import { useRateOptionsQuery, useRatePlanQuery } from "@/global/api/endpoints/ratesApi";
import { toClientApiError } from "@/global/api/errors";
import { formatCurrency, formatDate } from "@serene/shared/lib/utils/format";
import type { SeasonView } from "@serene/shared/modules/rates/rates.types";
import { RateCalendarPanel } from "../../_components/RateCalendarPanel";
import { RatePlanFormDialog } from "../../_components/RatePlanForm";
import {
  PlanAccountsDialog,
  PlanPackagesDialog,
  RemoveSeasonDialog,
  SeasonDialog,
} from "./PlanDialogs";
import { derivationLabel } from "../../_components/RatePlansView";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdays = (mask: number) =>
  mask === 127 ? "Every day" : WEEKDAYS.filter((_, i) => (mask & (1 << i)) !== 0).join(", ");

type Dialog =
  null | "edit" | "packages" | "accounts" | { season: SeasonView | "new" } | { remove: SeasonView };

/** One rate plan: configuration, seasons (base plans), packages and prices. */
export function RatePlanDetailView({ ratePlanId }: { ratePlanId: string }) {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const query = useRatePlanQuery(
    { propertyId: property.id, ratePlanId },
    { skip: !can("rates:read") },
  );
  const options = useRateOptionsQuery(property.id, { skip: !can("rates:read") });
  const error = toClientApiError(query.error);
  const [dialog, setDialog] = useState<Dialog>(null);

  if (isLoading) return <PageSkeleton title="Loading rate plan" layout="detail" />;
  if (query.isLoading) return <PageSkeleton title="Loading rate plan" layout="detail" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={error?.code === "NOT_FOUND" ? "empty" : "error"}
        title={error?.code === "NOT_FOUND" ? "Rate plan not found" : "Could not load the rate plan"}
        description={error?.message}
        action={
          <Link
            href={`/${property.code}/rates` as Route}
            className="text-sm text-brand hover:underline"
          >
            Back to rates
          </Link>
        }
      />
    );
  }
  const plan = query.data;
  const manage = plan.actions.manage;
  const money = (value: string | null) =>
    value === null ? "—" : formatCurrency(value, plan.currencyCode, "en", options.data?.minorUnits);
  const facts: [string, string][] = [
    [
      "Pricing",
      derivationLabel(
        {
          parent: plan.derivation
            ? { id: plan.derivation.parentRatePlanId, code: plan.derivation.parentCode }
            : null,
          derivation: plan.derivation,
        },
        plan.currencyCode,
      ),
    ],
    ["Currency", `${plan.currencyCode}${plan.taxInclusive ? " · prices include taxes" : ""}`],
    ["Room revenue code", `${plan.roomTransactionCode.code} · ${plan.roomTransactionCode.name}`],
    [
      "Room types",
      (options.data?.roomTypes ?? [])
        .filter((rt) => plan.roomTypeIds.includes(rt.id))
        .map((rt) => rt.code)
        .join(", ") || "—",
    ],
    [
      "Stay window",
      plan.stayFrom || plan.stayTo
        ? `${formatDate(plan.stayFrom)} → ${formatDate(plan.stayTo)}`
        : "Open",
    ],
    ["Derived plans", plan.derivedPlans.map((p) => p.code).join(", ") || "—"],
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        back={{ href: `/${property.code}/rates`, label: "Rates" }}
        icon={Tags}
        eyebrow="Rate plan"
        title={
          <>
            {plan.code} · {plan.name}
          </>
        }
        meta={
          <>
            {plan.status === "ACTIVE" ? (
              <Badge tone="success">Active</Badge>
            ) : (
              <Badge>Inactive</Badge>
            )}
            <Badge>{plan.kind.toLowerCase().replace("_", " ")}</Badge>
          </>
        }
        description={plan.description || undefined}
        actions={
          manage ? (
            <Button variant="secondary" onClick={() => setDialog("edit")}>
              Edit plan
            </Button>
          ) : undefined
        }
        footer={
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([term, value]) => (
              <div key={term} className="flex min-w-0 flex-col gap-0.5">
                <dt className="label-caps">{term}</dt>
                <dd className="text-sm break-words text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        }
      />

      <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Seasons and prices</h2>
          {manage && !plan.derivation ? (
            <Button
              size="sm"
              className="ms-auto min-h-11 md:min-h-0"
              onClick={() => setDialog({ season: "new" })}
            >
              Add season
            </Button>
          ) : null}
        </div>
        {plan.derivation ? (
          <p className="text-sm text-fg-secondary">
            Prices come from {plan.derivation.parentCode}, adjusted by{" "}
            {derivationLabel(
              { parent: { id: "", code: "" }, derivation: plan.derivation },
              plan.currencyCode,
            ).trim()}
            {plan.derivation.roundingIncrement
              ? `, rounded to ${formatCurrency(plan.derivation.roundingIncrement, plan.currencyCode)}`
              : ""}
            .
          </p>
        ) : plan.seasons.length === 0 ? (
          <StatusPanel
            kind="empty"
            title="No seasons yet"
            description="Without a season the plan cannot be priced."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {plan.seasons.map((season) => (
              <li key={season.id} className="flex flex-col gap-1 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{season.name}</span>
                  <span className="text-xs text-fg-muted">
                    {formatDate(season.startDate)} → {formatDate(season.endDate)} ·{" "}
                    {weekdays(season.daysOfWeek)} · priority {season.priority}
                  </span>
                  {manage ? (
                    <span className="ms-auto flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 md:min-h-0"
                        onClick={() => setDialog({ season })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 md:min-h-0"
                        onClick={() => setDialog({ remove: season })}
                      >
                        Delete
                      </Button>
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-4 text-sm text-fg-secondary">
                  {season.amounts.map((a) => (
                    <span key={a.roomTypeId}>
                      {a.roomTypeCode}: {money(a.oneAdult)}
                      {a.twoAdults ? ` / ${money(a.twoAdults)} (2)` : ""}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Included packages</h2>
          {plan.actions.managePackages ? (
            <Button
              size="sm"
              variant="secondary"
              className="ms-auto min-h-11 md:min-h-0"
              onClick={() => setDialog("packages")}
            >
              Change packages
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-fg-secondary">
          {plan.packages.length === 0
            ? "None."
            : plan.packages.map((p) => `${p.code} · ${p.name}`).join(", ")}
        </p>
      </section>

      {plan.requiresNegotiation ? (
        <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Companies</h2>
            <span className="text-xs text-fg-muted">
              Negotiated plan: quoted and sold only for these companies.
            </span>
            {plan.actions.manage && can("accounts:read") ? (
              <Button
                size="sm"
                variant="secondary"
                className="ms-auto min-h-11 md:min-h-0"
                onClick={() => setDialog("accounts")}
              >
                Change companies
              </Button>
            ) : null}
          </div>
          {plan.negotiated.length === 0 ? (
            <p className="text-sm text-fg-secondary">No company yet: the plan cannot be sold.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {plan.negotiated.map((n) => (
                <li key={n.account.id}>
                  <Link
                    href={`/${property.code}/companies/${n.account.id}` as Route}
                    className="text-brand hover:underline"
                  >
                    {n.account.name}
                  </Link>{" "}
                  <span className="text-fg-muted">
                    {n.validFrom || n.validTo
                      ? `${n.validFrom ? formatDate(n.validFrom) : "…"} → ${n.validTo ? formatDate(n.validTo) : "…"}`
                      : "open-ended"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Prices by night</h2>
        <RateCalendarPanel initialPlanId={plan.id} />
      </section>

      {dialog === "edit" ? (
        <RatePlanFormDialog plan={plan} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "packages" ? (
        <PlanPackagesDialog plan={plan} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "accounts" ? (
        <PlanAccountsDialog plan={plan} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === "object" && "season" in dialog ? (
        <SeasonDialog
          plan={plan}
          season={dialog.season === "new" ? undefined : dialog.season}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog && typeof dialog === "object" && "remove" in dialog ? (
        <RemoveSeasonDialog plan={plan} season={dialog.remove} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
