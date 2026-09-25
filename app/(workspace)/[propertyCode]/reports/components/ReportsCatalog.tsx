"use client";

import Link from "next/link";
import type { Route } from "next";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useReportCatalogQuery } from "@/lib/api/endpoints/reports.api";
import { toClientApiError } from "@/lib/api/errors";
import type { ReportGroup } from "@/modules/reports/reports.types";

const GROUPS: { group: ReportGroup; title: string; description: string }[] = [
  {
    group: "OPERATIONS",
    title: "Operations",
    description: "Guests arriving, staying and leaving.",
  },
  {
    group: "ROOMS",
    title: "Rooms and occupancy",
    description: "Room status, housekeeping and occupancy.",
  },
  {
    group: "FINANCE",
    title: "Revenue and finance",
    description: "Revenue, tax, payments and the guest ledger.",
  },
  { group: "AUDIT", title: "Audit", description: "Night-audit runs and the audit trail." },
];

/** The reports this user may run, grouped; the server filters by permission. */
export function ReportsCatalog() {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const catalog = useReportCatalogQuery(property.id);

  if (permissionsLoading || catalog.isLoading) {
    return <StatusPanel kind="loading" title="Loading reports" />;
  }
  if (catalog.isError || !catalog.data) {
    const error = toClientApiError(catalog.error);
    return (
      <StatusPanel
        kind="error"
        title="Could not load the reports"
        description={error?.message}
        requestId={error?.requestId}
      />
    );
  }
  if (catalog.data.reports.length === 0) {
    return (
      <StatusPanel
        kind="forbidden"
        title="No reports available"
        description="Your role at this property has no report permissions."
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-fg-secondary">
          Closed business dates come from the night-audit records and never change; the open date is
          live.
          {can("reports:financial")
            ? ""
            : " Revenue figures need the financial reports permission."}
        </p>
      </header>
      {GROUPS.map(({ group, title, description }) => {
        const reports = catalog.data.reports.filter((r) => r.group === group);
        if (reports.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`g-${group}`} className="flex flex-col gap-2">
            <div>
              <h2 id={`g-${group}`} className="text-sm font-semibold">
                {title}
              </h2>
              <p className="text-xs text-fg-muted">{description}</p>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reports.map((report) => (
                <li key={report.key}>
                  <Link
                    href={`/${property.code}/reports/${report.key}` as Route}
                    className="flex h-full flex-col gap-1 rounded-lg border border-border-subtle bg-surface p-3 hover:border-border-strong"
                  >
                    <span className="text-sm font-medium">{report.title}</span>
                    <span className="text-xs text-fg-secondary">{report.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
