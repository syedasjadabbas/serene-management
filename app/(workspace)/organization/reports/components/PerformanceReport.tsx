"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { ChartColumn } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { TextField } from "@/components/ui/TextField";
import { holdsAnywhere } from "@/components/workspace/sections";
import {
  useOrganizationOverviewQuery,
  useOrganizationPerformanceQuery,
} from "@/lib/api/endpoints/organization.api";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { addDays, daysBetween, isDateOnly } from "@/modules/business-date/business-date.policy";
import type { PerformanceFigures } from "@/modules/organization/organization.types";
import { Table, TBody, Th, Tr, THead, Td } from "@/components/ui/Table";

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

/** Mirrors the server's range limit (reports.policy MAX_REPORT_DAYS). */
const MAX_REPORT_DAYS = 366;

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

  if (overview.isLoading) return <PageSkeleton title="Loading" />;
  if (!from || !to) {
    const overviewError = toClientApiError(overview.error);
    if (overviewError) {
      return (
        <StatusPanel
          kind={overviewError.status === 403 ? "forbidden" : "error"}
          title={overviewError.status === 403 ? "Access denied" : "Could not load properties"}
          description={overviewError.message}
          requestId={overviewError.requestId}
          action={
            overviewError.status === 403 ? undefined : (
              <Button size="sm" variant="secondary" onClick={() => void overview.refetch()}>
                Retry
              </Button>
            )
          }
        />
      );
    }
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
  // Only the figures for the range in the URL; `data` would keep the
  // previous range's tables under the new header while this one runs.
  const data = report.currentData;
  const valueFrom = draftFrom ?? from;
  const valueTo = draftTo ?? to;
  // Mirrors the server's range rules so Run never sends a range it rejects.
  const rangeError =
    !valueFrom || !valueTo
      ? null
      : valueTo < valueFrom
        ? "Must be on or after the start date"
        : daysBetween(valueFrom, valueTo) + 1 > MAX_REPORT_DAYS
          ? `A report covers at most ${MAX_REPORT_DAYS} days`
          : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ChartColumn}
        breadcrumbs={[{ label: "Organization", href: "/organization" }, { label: "Reports" }]}
        title="Organization performance"
        description={
          <>
            {formatDate(from)} – {formatDate(to)} · business dates of each property
          </>
        }
        actions={
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
        }
      />
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border-subtle bg-surface p-3 shadow-card print:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          if (rangeError || !valueFrom || !valueTo) return;
          const next = new URLSearchParams({ from: valueFrom, to: valueTo });
          router.replace(`${pathname}?${next.toString()}` as Route);
        }}
      >
        <TextField
          label="From"
          type="date"
          value={valueFrom}
          max={valueTo || undefined}
          onChange={(e) => setDraftFrom(e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={valueTo}
          min={valueFrom || undefined}
          max={valueFrom ? addDays(valueFrom, MAX_REPORT_DAYS - 1) : undefined}
          errors={rangeError ? [rangeError] : undefined}
          onChange={(e) => setDraftTo(e.target.value)}
        />
        <Button
          type="submit"

          className="md:h-control md:text-sm"
          pending={report.isFetching}
          disabled={!!rangeError || !valueFrom || !valueTo}
        >
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
          action={
            error.status === 403 ? undefined : (
              <Button size="sm" variant="secondary" onClick={() => void report.refetch()}>
                Retry
              </Button>
            )
          }
        />
      ) : data && data.properties.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="No property has figures for this range"
          description={
            data.excluded.length > 0
              ? `Not included: ${data.excluded
                  .map(
                    (e) =>
                      `${e.property.code} (${e.reason === "NOT_LIVE" ? "not live" : "range after its business date"})`,
                  )
                  .join(", ")}. Choose a range on or before each property's business date.`
              : "Choose a range on or before each property's business date."
          }
        />
      ) : data ? (
        <>
          <Section id="rooms" title="Rooms and movements">
            <Table caption="Rooms and movements by property" minWidth="720px">
              <Head first="Property" columns={COUNT_COLUMNS.map(([label]) => label)} />
              <TBody>
                {data.properties.map((row) => (
                  <Tr interactive key={row.property.id}>
                    <Th scope="row">
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
                    </Th>
                    <Cells values={COUNT_COLUMNS.map(([, get]) => get(row))} />
                  </Tr>
                ))}
                {data.properties.length > 1 ? (
                  <Tr interactive className="-sunken">
                    <Th scope="row">All properties</Th>
                    <Cells values={COUNT_COLUMNS.map(([, get]) => get(data.overall))} />
                  </Tr>
                ) : null}
              </TBody>
            </Table>
          </Section>

          <Section id="money" title="Money by property (own currency)">
            <Table caption="Money by property, each in its own currency" minWidth="820px">
              <Head first="Property" columns={MONEY_COLUMNS.map(([label]) => label)} />
              <TBody>
                {data.properties.map((row) => (
                  <Tr interactive key={row.property.id}>
                    <Th scope="row">
                      <span className="me-2 font-mono text-xs text-fg-muted">
                        {row.property.code}
                      </span>
                      <Badge tone="neutral">{row.currencyCode}</Badge>
                    </Th>
                    <Cells
                      values={MONEY_COLUMNS.map(([, get]) => money(get(row), row.currencyCode))}
                    />
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Section>

          <Section id="currency" title="Totals per currency">
            <Table caption="Totals per currency, never converted" minWidth="820px">
              <Head first="Currency" columns={MONEY_COLUMNS.map(([label]) => label)} />
              <TBody>
                {data.currencies.map((row) => (
                  <Tr interactive key={row.currencyCode}>
                    <Th scope="row">
                      {row.currencyCode}
                      <span className="ms-2 text-xs font-normal text-fg-muted">
                        {row.propertyCount} {row.propertyCount === 1 ? "property" : "properties"}
                        {" · "}
                        {row.occupancy}% occ.
                      </span>
                    </Th>
                    <Cells
                      values={MONEY_COLUMNS.map(([, get]) => money(get(row), row.currencyCode))}
                    />
                  </Tr>
                ))}
              </TBody>
            </Table>
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
    <section
      aria-labelledby={id}
      className="rounded-lg border border-border-subtle bg-surface shadow-card"
    >
      <h2 id={id} className="border-b border-border-subtle px-4 py-2.5 font-semibold">
        {title}
      </h2>
      <div className="relative overflow-x-auto">{children}</div>
    </section>
  );
}

function Head({ first, columns }: { first: string; columns: string[] }) {
  return (
    <THead>
      <tr>
        <th scope="col" className="px-4 py-2 font-medium">
          {first}
        </th>
        {columns.map((label) => (
          <Th key={label} numeric>
            {label}
          </Th>
        ))}
      </tr>
    </THead>
  );
}

function Cells({ values }: { values: string[] }) {
  return (
    <>
      {values.map((value, index) => (
        // Columns are fixed per table, so the position is a stable key.
        <Td key={index} numeric>
          {value}
        </Td>
      ))}
    </>
  );
}
