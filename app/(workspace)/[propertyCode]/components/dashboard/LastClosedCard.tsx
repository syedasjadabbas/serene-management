import Link from "next/link";
import type { Route } from "next";
import { Card } from "@/components/ui/Card";
import type { DashboardView } from "@/modules/reports/reports.types";
import { formatCurrency, formatDate } from "@/lib/utils/format";

/**
 * Figures of the last closed business date (night-audit snapshot). Revenue,
 * ADR and RevPAR appear only with the financial reports permission, open
 * balances only when the server includes them; each links to its report
 * when the user can read reports.
 */
export function LastClosedCard({
  view,
  propertyCode,
}: {
  view: DashboardView;
  propertyCode: string;
}) {
  const last = view.lastClosed;
  const reports = view.access.reports;
  const link = (key: string, date: string) =>
    reports ? (`/${propertyCode}/reports/${key}?from=${date}&to=${date}` as Route) : null;
  const money = (value: string | null) =>
    value === null ? "—" : formatCurrency(value, view.currencyCode);

  const rows: { label: string; value: string; hint?: string; href: Route | null }[] = [];
  if (last) {
    rows.push({
      label: "Occupancy",
      value: `${last.occupancy}%`,
      hint: `${last.roomsSold} rooms sold`,
      href: link("occupancy", last.businessDate),
    });
    if (view.access.financial) {
      rows.push(
        {
          label: "Room revenue",
          value: money(last.roomRevenue),
          href: link("manager-flash", last.businessDate),
        },
        { label: "ADR", value: money(last.adr), href: link("occupancy", last.businessDate) },
        { label: "RevPAR", value: money(last.revpar), href: link("occupancy", last.businessDate) },
      );
    }
  }
  if (view.finance) {
    rows.push({
      label: "Open balances",
      value: money(view.finance.openBalance),
      hint: `${view.finance.openFolios} folios`,
      href: link("guest-ledger", view.businessDate),
    });
  }

  return (
    <Card
      title="Last closed date"
      description={last ? formatDate(last.businessDate) : "Night-audit snapshot"}
    >
      {last || view.finance ? (
        <dl className="flex flex-col divide-y divide-border-subtle">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-sm text-fg-secondary">
                {row.href ? (
                  <Link
                    href={row.href}
                    className="inline-flex min-h-6 items-center hover:text-fg hover:underline pointer-coarse:min-h-10"
                  >
                    {row.label}
                  </Link>
                ) : (
                  row.label
                )}
                {row.hint ? <span className="block text-xs text-fg-muted">{row.hint}</span> : null}
              </dt>
              <dd className="text-base font-semibold tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!last ? (
        <p className="text-sm text-fg-secondary">
          No business date has been closed yet. Figures for closed dates appear after the first
          night audit.
        </p>
      ) : null}
    </Card>
  );
}
