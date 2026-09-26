"use client";

import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/Badge";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useOrganizationOverviewQuery } from "@/lib/api/endpoints/organization.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate } from "@/lib/utils/format";

/**
 * Every accessible property at a glance, each on its own business date and
 * in its own currency. Figures come from each property's dashboard service;
 * nothing is summed across currencies.
 */
export function OrganizationOverviewPanel() {
  const overview = useOrganizationOverviewQuery();
  if (overview.isLoading) return <StatusPanel kind="loading" title="Loading the organization" />;
  if (overview.isError || !overview.data) {
    const error = toClientApiError(overview.error);
    return (
      <StatusPanel
        kind="error"
        title="Could not load the organization"
        description={error?.message}
        requestId={error?.requestId}
      />
    );
  }
  const data = overview.data;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">{data.organization.name}</h1>
        <p className="text-sm text-fg-secondary">
          {data.properties.length} {data.properties.length === 1 ? "property" : "properties"} you
          can access · each on its own business date and currency
        </p>
      </header>
      {data.properties.length === 0 ? (
        <StatusPanel kind="empty" title="No properties" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.properties.map(
            ({ property, businessDate, dateStatus, auditState, today, openBalance }) => (
              <li
                key={property.id}
                className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <div className="me-auto min-w-0">
                    <h2 className="font-semibold">
                      <span className="me-2 font-mono text-xs text-fg-muted">{property.code}</span>
                      {property.name}
                    </h2>
                    <p className="text-xs text-fg-muted">
                      {property.currencyCode} · {property.timezone}
                    </p>
                  </div>
                  <span className="flex flex-wrap justify-end gap-1">
                    {businessDate ? (
                      <Badge tone="neutral">Business date {businessDate}</Badge>
                    ) : (
                      <Badge tone="warning">Not live</Badge>
                    )}
                    {dateStatus === "IN_AUDIT" ? (
                      <Badge tone="warning">Night audit running</Badge>
                    ) : auditState === "AUDIT_OVERDUE" ? (
                      <Badge tone="danger">Audit overdue</Badge>
                    ) : auditState === "AWAITING_AUDIT" ? (
                      <Badge tone="info">Audit due</Badge>
                    ) : null}
                  </span>
                </div>
                {today ? (
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <Figure label="Occupancy" value={`${today.occupancy}%`} />
                    <Figure label="In house" value={String(today.inHouse)} />
                    <Figure
                      label="Rooms sold"
                      value={`${today.roomsOccupied} / ${today.roomsAvailable}`}
                    />
                    <Figure
                      label="Arrivals"
                      value={`${today.arrivalsDone} / ${today.arrivalsExpected}`}
                    />
                    <Figure
                      label="Departures"
                      value={`${today.departuresDone} / ${today.departuresExpected}`}
                    />
                    {openBalance !== null ? (
                      <Figure
                        label="Open balance"
                        value={formatCurrency(openBalance, property.currencyCode)}
                      />
                    ) : null}
                  </dl>
                ) : (
                  <p className="text-sm text-fg-secondary">
                    {businessDate
                      ? "Today's figures need the dashboard permission at this property."
                      : "Figures appear once the property is live."}
                  </p>
                )}
                <div className="mt-auto flex items-center gap-2 text-sm">
                  {businessDate ? (
                    <span className="text-xs text-fg-muted">{formatDate(businessDate)}</span>
                  ) : null}
                  <Link
                    href={`/${property.code}` as Route}
                    className="ms-auto inline-flex min-h-11 items-center font-medium text-brand hover:underline md:min-h-0"
                  >
                    Open {property.code} →
                  </Link>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-fg-muted uppercase">{label}</dt>
      <dd className="truncate font-medium tabular-nums">{value}</dd>
    </div>
  );
}
