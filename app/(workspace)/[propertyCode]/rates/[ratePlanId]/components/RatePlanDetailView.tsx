"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog, WeekdayPicker } from "@/components/ui/FormDialog";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useDeleteSeasonMutation,
  usePackagesQuery,
  useRateOptionsQuery,
  useRatePlanQuery,
  useSaveSeasonMutation,
  useSetPlanPackagesMutation,
} from "@/lib/api/endpoints/rates.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { RatePlanDetail, SeasonView } from "@/modules/rates/rates.types";
import { RateCalendarPanel } from "../../components/RateCalendarPanel";
import { RatePlanFormDialog } from "../../components/RatePlanForm";
import { derivationLabel } from "../../components/RatePlansView";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdays = (mask: number) =>
  mask === 127 ? "Every day" : WEEKDAYS.filter((_, i) => (mask & (1 << i)) !== 0).join(", ");

type Dialog = null | "edit" | "packages" | { season: SeasonView | "new" } | { remove: SeasonView };

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

  if (isLoading) return <StatusPanel kind="loading" title="Loading rate plan" />;
  if (!can("rates:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the rates:read permission."
      />
    );
  }
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading rate plan" />;
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
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <Link href={`/${property.code}/rates` as Route} className="hover:underline">
          Rates
        </Link>{" "}
        / {plan.code}
      </nav>
      <section className="rounded-lg border border-border-subtle bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <h1 className="text-lg font-semibold">
            {plan.code} · {plan.name}
          </h1>
          {plan.status === "ACTIVE" ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge>Inactive</Badge>
          )}
          <Badge>{plan.kind.toLowerCase().replace("_", " ")}</Badge>
          {manage ? (
            <Button
              size="sm"
              variant="secondary"
              className="ms-auto min-h-11 md:min-h-0"
              onClick={() => setDialog("edit")}
            >
              Edit plan
            </Button>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([term, value]) => (
            <div key={term} className="flex flex-col">
              <dt className="text-xs text-fg-muted">{term}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        {plan.description ? (
          <p className="px-4 pb-4 text-sm text-fg-secondary">{plan.description}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Seasons and prices</h2>
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
              ? `, rounded to ${plan.derivation.roundingIncrement}`
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

      <section className="rounded-lg border border-border-subtle bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Included packages</h2>
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

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Prices by night</h2>
        <RateCalendarPanel initialPlanId={plan.id} />
      </section>

      {dialog === "edit" ? (
        <RatePlanFormDialog plan={plan} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "packages" ? (
        <PlanPackagesDialog plan={plan} onClose={() => setDialog(null)} />
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

function SeasonDialog({
  plan,
  season,
  onClose,
}: {
  plan: RatePlanDetail;
  season?: SeasonView;
  onClose: () => void;
}) {
  const property = useProperty();
  const options = useRateOptionsQuery(property.id);
  const [save, state] = useSaveSeasonMutation();
  const types = (options.data?.roomTypes ?? []).filter((rt) => plan.roomTypeIds.includes(rt.id));
  const [name, setName] = useState(season?.name ?? "");
  const [startDate, setStartDate] = useState(season?.startDate ?? options.data?.businessDate ?? "");
  const [endDate, setEndDate] = useState(season?.endDate ?? "");
  const [days, setDays] = useState(season?.daysOfWeek ?? 127);
  const [priority, setPriority] = useState(String(season?.priority ?? 0));
  const [prices, setPrices] = useState<Record<string, { one: string; two: string }>>(
    Object.fromEntries(
      (season?.amounts ?? []).map((a) => [
        a.roomTypeId,
        { one: a.oneAdult, two: a.twoAdults ?? "" },
      ]),
    ),
  );
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const amounts = types
    .filter((rt) => prices[rt.id]?.one)
    .map((rt) => ({
      roomTypeId: rt.id,
      oneAdult: prices[rt.id]!.one,
      twoAdults: prices[rt.id]!.two || null,
    }));
  return (
    <FormDialog
      title={season ? `Edit season · ${season.name}` : "New season"}
      description="The highest-priority season covering a night and weekday sets its price; equal priorities may not overlap."
      onClose={onClose}
      onSubmit={async () => {
        const result = await save({
          propertyId: property.id,
          ratePlanId: plan.id,
          seasonId: season?.id,
          body: {
            version: plan.version,
            name: name.trim(),
            startDate,
            endDate,
            daysOfWeek: days,
            priority: Number.parseInt(priority, 10) || 0,
            amounts,
            reason: reason.trim(),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save season"
      disabled={
        !name.trim() || !startDate || !endDate || amounts.length === 0 || reason.trim().length < 3
      }
      pending={state.isLoading}
      error={error}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="sm:col-span-2"
        />
        <TextField
          label="First night"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <TextField
          label="Last night"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <TextField
          label="Priority"
          inputMode="numeric"
          value={priority}
          onChange={(e) => setPriority(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      <WeekdayPicker value={days} onChange={setDays} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-fg-secondary">
          Prices ({plan.currencyCode})
        </legend>
        {types.map((rt) => (
          <div
            key={rt.id}
            className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2"
          >
            <span className="pb-2 text-sm font-medium">{rt.code}</span>
            <TextField
              label="1 adult"
              inputMode="decimal"
              value={prices[rt.id]?.one ?? ""}
              onChange={(e) =>
                setPrices((p) => ({
                  ...p,
                  [rt.id]: { one: e.target.value.trim(), two: p[rt.id]?.two ?? "" },
                }))
              }
            />
            <TextField
              label="2 adults"
              inputMode="decimal"
              value={prices[rt.id]?.two ?? ""}
              onChange={(e) =>
                setPrices((p) => ({
                  ...p,
                  [rt.id]: { one: p[rt.id]?.one ?? "", two: e.target.value.trim() },
                }))
              }
            />
          </div>
        ))}
      </fieldset>
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormDialog>
  );
}

function RemoveSeasonDialog({
  plan,
  season,
  onClose,
}: {
  plan: RatePlanDetail;
  season: SeasonView;
  onClose: () => void;
}) {
  const property = useProperty();
  const [remove, state] = useDeleteSeasonMutation();
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      title={`Delete season · ${season.name}`}
      description="Nights it priced fall back to the next season (or become unpriced). Booked reservations keep their prices."
      onClose={onClose}
      onSubmit={async () => {
        const result = await remove({
          propertyId: property.id,
          ratePlanId: plan.id,
          seasonId: season.id,
          body: { version: plan.version, reason: reason.trim() },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Delete season"
      danger
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormDialog>
  );
}

function PlanPackagesDialog({ plan, onClose }: { plan: RatePlanDetail; onClose: () => void }) {
  const property = useProperty();
  const packages = usePackagesQuery(property.id);
  const [save, state] = useSetPlanPackagesMutation();
  const [ids, setIds] = useState(plan.packages.map((p) => p.id));
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      title={`Packages in ${plan.code}`}
      description="Included packages are carved out of the room rate when nights are posted."
      onClose={onClose}
      onSubmit={async () => {
        const result = await save({
          propertyId: property.id,
          ratePlanId: plan.id,
          body: { version: plan.version, packageIds: ids, reason: reason.trim() },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save packages"
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      {(packages.data ?? [])
        .filter((p) => p.status === "ACTIVE")
        .map((p) => (
          <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={(e) =>
                setIds((list) =>
                  e.target.checked ? [...list, p.id] : list.filter((id) => id !== p.id),
                )
              }
            />
            {p.code} · {p.name}
          </label>
        ))}
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormDialog>
  );
}
