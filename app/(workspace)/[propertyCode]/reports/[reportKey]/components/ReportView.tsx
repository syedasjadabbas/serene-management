"use client";

import { ChartColumn } from "lucide-react";
import Link from "next/link";
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
import { reportExportUrl, useReportQuery } from "@/lib/api/endpoints/reports.api";
import { useBookingOptionsQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils/format";
import type { ReportQuery } from "@/modules/reports/reports.schema";
import type { ReportCell, ReportColumn } from "@/modules/reports/reports.types";

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
  const options = useBookingOptionsQuery(property.id, {
    skip: !report.data?.roomTypeFilter || !can("reservations:read"),
  });
  const [from, setFrom] = useState(query.from ?? businessDate ?? "");
  const [to, setTo] = useState(query.to ?? businessDate ?? "");
  const [roomTypeId, setRoomTypeId] = useState(query.roomTypeId ?? "");
  const [risk, setRisk] = useState(query.risk ?? "");

  function apply() {
    const next = new URLSearchParams();
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (roomTypeId) next.set("roomTypeId", roomTypeId);
    if (risk) next.set("risk", risk);
    router.replace(`${pathname}?${next.toString()}` as Route);
  }

  function goToOffset(offset: number) {
    const next = new URLSearchParams(search.toString());
    if (offset > 0) next.set("offset", String(offset));
    else next.delete("offset");
    router.replace(`${pathname}?${next.toString()}` as Route);
  }

  const back = (
    <nav className="text-sm print:hidden">
      <Link className="text-brand hover:underline" href={`/${property.code}/reports` as Route}>
        ← Reports
      </Link>
    </nav>
  );

  if (report.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <StatusPanel kind="loading" title="Running the report" />
      </div>
    );
  }
  if (report.isError || !report.data) {
    const error = toClientApiError(report.error);
    return (
      <div className="flex flex-col gap-3">
        {back}
        <StatusPanel
          kind={error?.status === 403 ? "forbidden" : "error"}
          title={error?.status === 403 ? "Access denied" : "Could not run the report"}
          description={error?.message}
          requestId={error?.requestId}
        />
      </div>
    );
  }
  const data = report.data;
  const cell = (column: ReportColumn, value: ReportCell | undefined) =>
    formatCell(column, value ?? null, data.currencyCode, property.timezone);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ChartColumn}
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Reports", href: `/${property.code}/reports` },
          { label: data.title },
        ]}
        title={data.title}
        description={
          <>
            {property.name} ·{" "}
            {data.ranged
              ? data.params.from === data.params.to
                ? formatDate(data.params.from)
                : `${formatDate(data.params.from)} – ${formatDate(data.params.to)}`
              : "Now"}{" "}
            · business date {data.businessDate}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            {data.canExport ? (
              <a
                className={buttonClass("secondary", "sm")}
                href={reportExportUrl(property.id, reportKey, {
                  ...data.params,
                  roomTypeId: data.params.roomTypeId ?? undefined,
                  risk: (data.params.risk as ReportQuery["risk"]) ?? undefined,
                })}
                download
              >
                Export CSV
              </a>
            ) : null}
          </div>
        }
      />

      {data.ranged || data.roomTypeFilter || data.riskFilter ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border-subtle bg-surface p-3 print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          {data.ranged ? (
            <>
              <TextField
                label="From"
                type="date"
                value={from || data.params.from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <TextField
                label="To"
                type="date"
                value={to || data.params.to}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          ) : null}
          {data.roomTypeFilter && options.data ? (
            <Select
              label="Room type"
              placeholder="All room types"
              options={options.data.roomTypes.map((rt) => ({
                value: rt.id,
                label: `${rt.code} · ${rt.name}`,
              }))}
              value={roomTypeId}
              onChange={(e) => setRoomTypeId(e.target.value)}
            />
          ) : null}
          {data.riskFilter ? (
            <Select
              label="Risk"
              placeholder="Any risk"
              options={[
                { value: "HIGH", label: "High" },
                { value: "STANDARD", label: "Standard" },
                { value: "LOW", label: "Low" },
              ]}
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
            />
          ) : null}
          <Button type="submit" size="md" variant="secondary" pending={report.isFetching}>
            Run
          </Button>
        </form>
      ) : null}

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
            disabled={data.page.offset === 0 || report.isFetching}
            onClick={() => goToOffset(Math.max(0, data.page.offset - data.page.limit))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={
              data.page.offset + data.page.limit >= data.page.totalRows || report.isFetching
            }
            onClick={() => goToOffset(data.page.offset + data.page.limit)}
          >
            Next
          </Button>
        </nav>
      ) : null}
      <p className="text-xs text-fg-muted">
        Generated {formatDateTime(data.generatedAt, property.timezone)} · amounts in{" "}
        {data.currencyCode}
      </p>
    </div>
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
