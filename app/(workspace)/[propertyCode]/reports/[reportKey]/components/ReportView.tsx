"use client";

import { ChartColumn } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  reportExportUrl,
  useReportCatalogQuery,
  useReportQuery,
} from "@/lib/api/endpoints/reports.api";
import { useBookingOptionsQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils/format";
import { addDays, daysBetween } from "@/modules/business-date/business-date.policy";
import type { ReportQuery } from "@/modules/reports/reports.schema";
import type {
  ReportCatalogItem,
  ReportCell,
  ReportColumn,
  ReportResult,
} from "@/modules/reports/reports.types";

/** Mirrors the server's range limit (reports.policy MAX_REPORT_DAYS). */
const MAX_REPORT_DAYS = 366;

/**
 * Reports that read only the end date (manager's flash: the day and month to
 * date as of `to`; guest ledger: balances as of `to`). They get a single
 * "As of" input instead of a misleading From–To pair.
 */
const SINGLE_DATE_REPORTS: ReadonlySet<string> = new Set(["manager-flash", "guest-ledger"]);

/**
 * One report: the date range (and room type / risk where the report offers
 * them) live in the URL so a report can be linked and reloaded; figures,
 * totals and notes come from the server; CSV export and print for users
 * who may export.
 */
export function ReportView({ reportKey }: { reportKey: string }) {
  const property = useProperty();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const businessDate = useBusinessDate().data?.businessDate ?? null;
  const { can } = usePermissions(property.id);
  const offsetParam = Number(search.get("offset") ?? "0");
  const query: ReportQuery = {
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
    roomTypeId: search.get("roomTypeId") ?? undefined,
    risk: (search.get("risk") as ReportQuery["risk"]) ?? undefined,
    // Large reports come in pages (H10); normal ones fit on the first page.
    ...(Number.isInteger(offsetParam) && offsetParam > 0 ? { offset: offsetParam } : {}),
  };
  const report = useReportQuery({ propertyId: property.id, reportKey, query });
  const catalog = useReportCatalogQuery(property.id);
  // Only the result for the current URL is shown; `data` would keep the
  // previous selection's figures on screen while the new one runs.
  const current = report.currentData;
  // What the report offers (date range, filters) is known from the catalog
  // even when the run itself fails, so the form stays usable.
  const meta: ReportCatalogItem | undefined =
    current ??
    catalog.data?.reports.find((r) => r.key === reportKey) ??
    (report.data?.key === reportKey ? report.data : undefined);
  const singleDate = SINGLE_DATE_REPORTS.has(reportKey);
  const error = toClientApiError(report.error);
  const ranged = meta?.ranged ?? true;
  const offersRoomType = meta?.roomTypeFilter ?? false;
  const offersRisk = meta?.riskFilter ?? !!query.risk;
  const options = useBookingOptionsQuery(property.id, {
    skip: !offersRoomType || !can("reservations:read"),
  });

  // Drafts override the applied values only until the URL changes; the
  // applied values mirror the server (to = to ?? from, from = from ?? to)
  // and prefer the resolved params of the report on screen.
  const urlKey = search.toString();
  const [draft, setDraft] = useState<{
    key: string;
    from?: string;
    to?: string;
    roomTypeId?: string;
    risk?: string;
  }>({ key: urlKey });
  const drafts = draft.key === urlKey ? draft : { key: urlKey };
  const setField = (field: "from" | "to" | "roomTypeId" | "risk", value: string) =>
    setDraft({ ...drafts, [field]: value });
  const appliedFrom = current?.params.from ?? query.from ?? query.to ?? businessDate ?? "";
  const appliedTo = current?.params.to ?? query.to ?? query.from ?? businessDate ?? "";
  const from = drafts.from ?? appliedFrom;
  const to = drafts.to ?? appliedTo;
  const roomTypeId = drafts.roomTypeId ?? query.roomTypeId ?? "";
  const risk = drafts.risk ?? query.risk ?? "";

  const dateError =
    !ranged || singleDate || !from || !to
      ? null
      : to < from
        ? "Must be on or after the start date"
        : daysBetween(from, to) + 1 > MAX_REPORT_DAYS
          ? `A report covers at most ${MAX_REPORT_DAYS} days`
          : null;

  function apply() {
    if (dateError) return;
    const next = new URLSearchParams();
    if (ranged) {
      if (!singleDate && from) next.set("from", from);
      if (to) next.set("to", to);
    }
    if (roomTypeId) next.set("roomTypeId", roomTypeId);
    if (risk) next.set("risk", risk);
    router.replace(`${pathname}?${next.toString()}` as Route);
  }

  function clearRoomType() {
    const next = new URLSearchParams(search.toString());
    next.delete("roomTypeId");
    next.delete("offset");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}` as Route);
  }

  function goToOffset(offset: number) {
    const next = new URLSearchParams(search.toString());
    if (offset > 0) next.set("offset", String(offset));
    else next.delete("offset");
    router.replace(`${pathname}?${next.toString()}` as Route);
  }

  const title = meta?.title ?? "Report";
  const showRoomTypeSelect = offersRoomType && !!options.data;
  const hiddenRoomTypeFilter = !!query.roomTypeId && !showRoomTypeSelect;
  const showForm = meta
    ? meta.ranged || meta.roomTypeFilter || meta.riskFilter
    : !!error && error.status !== 403;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ChartColumn}
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Reports", href: `/${property.code}/reports` },
          { label: title },
        ]}
        title={title}
        description={
          current ? (
            <>
              {property.name} ·{" "}
              {current.ranged
                ? singleDate
                  ? `As of ${formatDate(current.params.to)}`
                  : current.params.from === current.params.to
                    ? formatDate(current.params.from)
                    : `${formatDate(current.params.from)} – ${formatDate(current.params.to)}`
                : "Now"}{" "}
              · business date {current.businessDate}
            </>
          ) : (
            property.name
          )
        }
        actions={
          current ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
              {current.canExport ? (
                <a
                  className={buttonClass("secondary", "sm")}
                  href={reportExportUrl(property.id, reportKey, {
                    ...current.params,
                    roomTypeId: current.params.roomTypeId ?? undefined,
                    risk: (current.params.risk as ReportQuery["risk"]) ?? undefined,
                  })}
                  download
                >
                  Export CSV
                </a>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {showForm ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border-subtle bg-surface p-3 print:hidden"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          {ranged ? (
            singleDate ? (
              <TextField
                label="As of"
                type="date"
                value={to}
                onChange={(e) => setField("to", e.target.value)}
              />
            ) : (
              <>
                <TextField
                  label="From"
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setField("from", e.target.value)}
                />
                <TextField
                  label="To"
                  type="date"
                  value={to}
                  min={from || undefined}
                  max={from ? addDays(from, MAX_REPORT_DAYS - 1) : undefined}
                  errors={dateError ? [dateError] : undefined}
                  onChange={(e) => setField("to", e.target.value)}
                />
              </>
            )
          ) : null}
          {showRoomTypeSelect && options.data ? (
            <Select
              label="Room type"
              placeholder="All room types"
              options={options.data.roomTypes.map((rt) => ({
                value: rt.id,
                label: `${rt.code} · ${rt.name}`,
              }))}
              value={roomTypeId}
              onChange={(e) => setField("roomTypeId", e.target.value)}
            />
          ) : null}
          {offersRisk ? (
            <Select
              label="Risk"
              placeholder="Any risk"
              options={[
                { value: "HIGH", label: "High" },
                { value: "STANDARD", label: "Standard" },
                { value: "LOW", label: "Low" },
              ]}
              value={risk}
              onChange={(e) => setField("risk", e.target.value)}
            />
          ) : null}
          <Button
            type="submit"
            size="md"
            variant="secondary"
            pending={report.isFetching}
            disabled={!!dateError}
          >
            Run
          </Button>
        </form>
      ) : null}

      {hiddenRoomTypeFilter ? (
        <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
          <span className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-2.5 py-1">
            Room type filter active
            <button
              type="button"
              className="font-medium text-brand hover:underline"
              onClick={clearRoomType}
            >
              Clear
            </button>
          </span>
        </div>
      ) : null}

      {report.isFetching && !current ? (
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
      ) : current ? (
        <ReportBody
          data={current}
          timezone={property.timezone}
          fetching={report.isFetching}
          onPage={goToOffset}
        />
      ) : null}
    </div>
  );
}

function ReportBody({
  data,
  timezone,
  fetching,
  onPage,
}: {
  data: ReportResult;
  timezone: string;
  fetching: boolean;
  onPage: (offset: number) => void;
}) {
  const cell = (column: ReportColumn, value: ReportCell | undefined) =>
    formatCell(column, value ?? null, data.currencyCode, timezone);

  return (
    <>
      {data.notes.length > 0 ? (
        <Alert tone="info">
          <ul className="list-disc ps-4">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {data.rows.length === 0 ? (
        <StatusPanel kind="empty" title="Nothing to report for this selection" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <caption className="sr-only">{data.title}</caption>
            <thead className="bg-surface-sunken text-xs text-fg-muted">
              <tr>
                {data.columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-3 py-2 font-medium whitespace-nowrap ${alignOf(column)}`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {data.rows.map((row, index) => (
                <tr key={index} className="bg-surface">
                  {data.columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-1.5 whitespace-nowrap ${alignOf(column)}`}
                    >
                      {cell(column, row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {data.totals ? (
              <tfoot className="border-t-2 border-border bg-surface-sunken font-medium">
                <tr>
                  {data.columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2 whitespace-nowrap ${alignOf(column)}`}
                    >
                      {cell(column, data.totals![column.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
      {data.page.totalRows > data.page.limit ? (
        <nav
          aria-label="Report pages"
          className="flex flex-wrap items-center gap-2 text-sm print:hidden"
        >
          <span className="me-auto text-fg-secondary">
            Rows {(data.page.offset + 1).toLocaleString()}–
            {Math.min(data.page.offset + data.page.limit, data.page.totalRows).toLocaleString()} of{" "}
            {data.page.totalRows.toLocaleString()}. Totals cover every row
            {data.canExport ? "; the CSV export contains them all" : ""}.
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={data.page.offset === 0 || fetching}
            onClick={() => onPage(Math.max(0, data.page.offset - data.page.limit))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={data.page.offset + data.page.limit >= data.page.totalRows || fetching}
            onClick={() => onPage(data.page.offset + data.page.limit)}
          >
            Next
          </Button>
        </nav>
      ) : null}
      <p className="text-xs text-fg-muted">
        Generated {formatDateTime(data.generatedAt, timezone)} · amounts in {data.currencyCode}
      </p>
    </>
  );
}

function alignOf(column: ReportColumn): string {
  return column.type === "money" || column.type === "number" || column.type === "percent"
    ? "text-right tabular-nums"
    : "text-left";
}

function formatCell(
  column: ReportColumn,
  value: ReportCell,
  currency: string,
  timezone: string,
): string {
  if (value === null || value === "") return "";
  switch (column.type) {
    case "money":
      return typeof value === "string" && /^-?\d/.test(value)
        ? formatCurrency(value, currency)
        : String(value);
    case "percent":
      return /^-?\d/.test(String(value)) ? `${value}%` : String(value);
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDate(String(value)) : String(value);
    case "datetime":
      return /^\d{4}-/.test(String(value))
        ? formatDateTime(String(value), timezone)
        : String(value);
    default:
      return String(value);
  }
}
