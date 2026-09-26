"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { holdsAnywhere } from "@/components/workspace/sections";
import {
  useOrganizationOverviewQuery,
  useOrganizationPerformanceQuery,
} from "@/lib/api/endpoints/organization.api";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { addDays, isDateOnly } from "@/modules/business-date/business-date.policy";
import type { PerformanceFigures } from "@/modules/organization/organization.types";

type Counts = Pick<
  PerformanceFigures,
  | "nights"
  | "roomsAvailable"
  | "roomsSold"
  | "occupancy"
  | "arrivals"
  | "departures"
  | "noShows"
  | "cancellations"
>;

const COUNT_COLUMNS: [string, (f: Counts) => string][] = [
  ["Nights", (f) => String(f.nights)],
  ["Available", (f) => String(f.roomsAvailable)],
  ["Sold", (f) => String(f.roomsSold)],
  ["Occupancy", (f) => `${f.occupancy}%`],
  ["Arrivals", (f) => String(f.arrivals)],
  ["Departures", (f) => String(f.departures)],
  ["No-shows", (f) => String(f.noShows)],
  ["Cancellations", (f) => String(f.cancellations)],
];

const MONEY_COLUMNS: [string, (f: PerformanceFigures) => string | null][] = [
  ["ADR", (f) => f.adr],
  ["RevPAR", (f) => f.revpar],
  ["Room revenue", (f) => f.roomRevenue],
  ["Total revenue", (f) => f.totalRevenue],
  ["Tax", (f) => f.tax],
  ["Payments", (f) => f.payments],
  ["Refunds", (f) => f.refunds],
  ["Open balance", (f) => f.openBalance],
];

/**
 * Rooms, movements and money for a business-date range. Counts may be
 * totalled across properties; money stays in each property's currency and
 * is subtotalled per currency — never converted or summed across
 * currencies (D4). The range lives in the URL.
 */
export function PerformanceReport() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data: me } = useMeQuery();
  const overview = useOrganizationOverviewQuery();
  const latest =
    overview.data?.properties
      .map((p) => p.businessDate)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;
  const fromParam = search.get("from");
  const toParam = search.get("to");
  const to = toParam && isDateOnly(toParam) ? toParam : latest;
  const from = fromParam && isDateOnly(fromParam) ? fromParam : to ? addDays(to, -6) : null;
  const report = useOrganizationPerformanceQuery(
    { from: from ?? "", to: to ?? "" },
    { skip: !from || !to },
  );
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const [draftTo, setDraftTo] = useState<string | null>(null);

  if (overview.isLoading) return <StatusPanel kind="loading" title="Loading" />;
  if (!from || !to) {
    return (
      <StatusPanel
        kind="empty"
        title="No live property"
        description="Reports need at least one property with a business date."
      />
    );
  }
  const error = toClientApiError(report.error);
  const canExport = me ? holdsAnywhere(me, "reports:export") : false;
  const data = report.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <header className="flex flex-wrap items-end gap-2">
        <div className="me-auto">
          <h1 className="text-xl font-semibold">Organization performance</h1>
          <p className="text-sm text-fg-secondary">
            {formatDate(from)} – {formatDate(to)} · business dates of each property
          </p>
        </div>
        <div className="flex gap-1.5 print:hidden">
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          {canExport ? (
            <a
              className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-xs hover:bg-surface-sunken"
              href={`/api/v1/organization/reports/performance/export?${new URLSearchParams({ from, to }).toString()}`}
              download
            >
              Export CSV
            </a>
          ) : null}
        </div>
      </header>
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border-subtle bg-surface p-3 print:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams({ from: draftFrom ?? from, to: draftTo ?? to });
          router.replace(`${pathname}?${next.toString()}` as Route);
        }}
      >
        <TextField
          label="From"
          type="date"
          value={draftFrom ?? from}
          onChange={(e) => setDraftFrom(e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={draftTo ?? to}
          onChange={(e) => setDraftTo(e.target.value)}
        />
        <Button type="submit" size="touch" className="md:h-control md:text-sm">
          Run
        </Button>
      </form>

      {report.isFetching && !data ? (
        <StatusPanel kind="loading" title="Running the report" />
      ) : error ? (
        <StatusPanel
          kind={error.status === 403 ? "forbidden" : "error"}
          title={error.status === 403 ? "Access denied" : "Could not run the report"}
          description={Object.values(error.fieldErrors).flat()[0] ?? error.message}
          requestId={error.requestId}
        />
      ) : data ? (
        <>
          <Section id="rooms" title="Rooms and movements">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Rooms and movements by property</caption>
              <Head first="Property" columns={COUNT_COLUMNS.map(([label]) => label)} />
              <tbody className="divide-y divide-border-subtle">
                {data.properties.map((row) => (
                  <tr key={row.property.id}>
                    <th scope="row" className="px-4 py-2 text-left font-medium">
                      <span className="me-2 font-mono text-xs text-fg-muted">
                        {row.property.code}
                      </span>
                      {row.property.name}
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        <Badge tone="neutral">Business date {row.businessDate}</Badge>
                        {row.dateStatus === "IN_AUDIT" ? (
                          <Badge tone="warning">Night audit running</Badge>
                        ) : null}
                        {row.liveIncluded ? <Badge tone="info">Includes live date</Badge> : null}
                        {row.coveredTo < to ? (
                          <Badge tone="warning">Through {row.coveredTo}</Badge>
                        ) : null}
                      </span>
                    </th>
                    <Cells values={COUNT_COLUMNS.map(([, get]) => get(row))} />
                  </tr>
                ))}
                {data.properties.length > 1 ? (
                  <tr className="bg-surface-sunken font-medium">
                    <th scope="row" className="px-4 py-2 text-left">
                      All properties
                    </th>
                    <Cells values={COUNT_COLUMNS.map(([, get]) => get(data.overall))} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Section>

          <Section id="money" title="Money by property (own currency)">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Money by property, each in its own currency</caption>
              <Head first="Property" columns={MONEY_COLUMNS.map(([label]) => label)} />
              <tbody className="divide-y divide-border-subtle">
                {data.properties.map((row) => (
                  <tr key={row.property.id}>
                    <th scope="row" className="px-4 py-2 text-left font-medium">
                      <span className="me-2 font-mono text-xs text-fg-muted">
                        {row.property.code}
                      </span>
                      <Badge tone="neutral">{row.currencyCode}</Badge>
                    </th>
                    <Cells
                      values={MONEY_COLUMNS.map(([, get]) => money(get(row), row.currencyCode))}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section id="currency" title="Totals per currency">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Totals per currency, never converted</caption>
              <Head first="Currency" columns={MONEY_COLUMNS.map(([label]) => label)} />
              <tbody className="divide-y divide-border-subtle">
                {data.currencies.map((row) => (
                  <tr key={row.currencyCode}>
                    <th scope="row" className="px-4 py-2 text-left font-medium">
                      {row.currencyCode}
                      <span className="ms-2 text-xs font-normal text-fg-muted">
                        {row.propertyCount} {row.propertyCount === 1 ? "property" : "properties"}
                        {" · "}
                        {row.occupancy}% occ.
                      </span>
                    </th>
                    <Cells
                      values={MONEY_COLUMNS.map(([, get]) => money(get(row), row.currencyCode))}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {data.excluded.length > 0 ? (
            <Alert tone="info">
              Not included:{" "}
              {data.excluded
                .map(
                  (e) =>
                    `${e.property.code} (${e.reason === "NOT_LIVE" ? "not live" : "range after its business date"})`,
                )
                .join(", ")}
            </Alert>
          ) : null}
          <ul className="list-disc ps-5 text-xs text-fg-secondary">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            <li>Open balance is the current balance of open folios, not range-bound.</li>
          </ul>
        </>
      ) : null}
    </div>
  );
}

function money(value: string | null, currency: string) {
  return value === null ? "—" : formatCurrency(value, currency);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border-subtle bg-surface">
      <h2 id={id} className="border-b border-border-subtle px-4 py-2.5 font-semibold">
        {title}
      </h2>
      <div className="relative overflow-x-auto">{children}</div>
    </section>
  );
}

function Head({ first, columns }: { first: string; columns: string[] }) {
  return (
    <thead className="text-left text-xs text-fg-muted">
      <tr>
        <th scope="col" className="px-4 py-2 font-medium">
          {first}
        </th>
        {columns.map((label) => (
          <th key={label} scope="col" className="py-2 pe-3 text-right font-medium">
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Cells({ values }: { values: string[] }) {
  return (
    <>
      {values.map((value, index) => (
        // Columns are fixed per table, so the position is a stable key.
        <td key={index} className="py-2 pe-3 text-right tabular-nums">
          {value}
        </td>
      ))}
    </>
  );
}
