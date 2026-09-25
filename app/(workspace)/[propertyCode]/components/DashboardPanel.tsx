"use client";

import Link from "next/link";
import type { Route } from "next";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useProperty } from "@/hooks/useProperty";
import { useDashboardQuery } from "@/lib/api/endpoints/reports.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";

/**
 * Property KPIs (Guide §3.1): today live, the last closed business date
 * from its night-audit snapshot, and the occupancy trend. Revenue figures
 * appear only for users with the financial reports permission. Tiles link
 * to the report behind them.
 */
export function DashboardPanel() {
  const property = useProperty();
  const query = useDashboardQuery(property.id, { pollingInterval: 120_000 });

  if (query.isLoading) return <StatusPanel kind="loading" title="Loading today's figures" />;
  if (query.isError || !query.data) {
    const error = toClientApiError(query.error);
    return (
      <StatusPanel
        kind={error?.status === 403 ? "forbidden" : "error"}
        title={error?.status === 403 ? "No dashboard access" : "Could not load today's figures"}
        description={error?.message}
        requestId={error?.requestId}
      />
    );
  }
  const view = query.data;
  const reports = view.access.reports;
  const link = (key: string, date = view.businessDate) =>
    reports ? (`/${property.code}/reports/${key}?from=${date}&to=${date}` as Route) : null;
  const money = (value: string | null) =>
    value === null ? "—" : formatCurrency(value, view.currencyCode);

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="today-heading" className="flex flex-col gap-2">
        <h2 id="today-heading" className="text-sm font-semibold">
          Today · business date {view.businessDate}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Occupancy tonight"
            value={`${view.today.occupancy}%`}
            hint={`${view.today.roomsOccupied} of ${view.today.roomsAvailable} rooms`}
            href={link("occupancy")}
          />
          <Tile
            label="Arrivals"
            value={`${view.today.arrivalsDone} / ${view.today.arrivalsDone + view.today.arrivalsExpected}`}
            hint={
              view.today.vipArrivals ? `${view.today.vipArrivals} VIP expected` : "checked in / due"
            }
            href={link("arrivals")}
          />
          <Tile
            label="Departures"
            value={`${view.today.departuresDone} / ${view.today.departuresDone + view.today.departuresExpected}`}
            hint="departed / due"
            href={link("departures")}
          />
          <Tile
            label="In house"
            value={String(view.today.inHouse)}
            hint="rooms"
            href={reports ? (`/${property.code}/reports/in-house` as Route) : null}
          />
          <Tile
            label="Dirty rooms"
            value={String(view.rooms.dirty)}
            hint={`${view.rooms.clean + view.rooms.inspected} clean or inspected`}
            href={reports ? (`/${property.code}/reports/room-status` as Route) : null}
          />
          <Tile
            label="Out of order"
            value={String(view.rooms.outOfOrder)}
            hint={`${view.rooms.outOfService} out of service`}
            href={reports ? (`/${property.code}/reports/room-status` as Route) : null}
          />
        </div>
      </section>

      {view.lastClosed ? (
        <section aria-labelledby="closed-heading" className="flex flex-col gap-2">
          <h2 id="closed-heading" className="text-sm font-semibold">
            Last closed date · {view.lastClosed.businessDate}
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Tile
              label="Occupancy"
              value={`${view.lastClosed.occupancy}%`}
              hint={`${view.lastClosed.roomsSold} rooms sold`}
              href={link("occupancy", view.lastClosed.businessDate)}
            />
            {view.access.financial ? (
              <>
                <Tile
                  label="Room revenue"
                  value={money(view.lastClosed.roomRevenue)}
                  href={link("manager-flash", view.lastClosed.businessDate)}
                />
                <Tile
                  label="ADR"
                  value={money(view.lastClosed.adr)}
                  href={link("occupancy", view.lastClosed.businessDate)}
                />
                <Tile
                  label="RevPAR"
                  value={money(view.lastClosed.revpar)}
                  href={link("occupancy", view.lastClosed.businessDate)}
                />
              </>
            ) : null}
            {view.finance ? (
              <Tile
                label="Open balances"
                value={money(view.finance.openBalance)}
                hint={`${view.finance.openFolios} folios`}
                href={link("guest-ledger")}
              />
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-sm text-fg-secondary">
          No business date has been closed yet. Figures for closed dates appear after the first
          night audit.
        </p>
      )}

      {view.trend.length > 1 ? (
        <section aria-labelledby="trend-heading" className="flex flex-col gap-2">
          <h2 id="trend-heading" className="text-sm font-semibold">
            Occupancy, last {view.trend.length} closed dates
          </h2>
          <div className="h-48 rounded-lg border border-border-subtle bg-surface p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={view.trend.map((t) => ({
                  date: t.businessDate,
                  occupancy: Number(t.occupancy),
                }))}
              >
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => formatShortDate(d)}
                  fontSize={11}
                />
                <YAxis domain={[0, 100]} unit="%" fontSize={11} width={40} />
                <Tooltip formatter={(value) => [`${value}%`, "Occupancy"]} />
                <Line
                  type="monotone"
                  dataKey="occupancy"
                  stroke="currentColor"
                  className="text-brand"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: Route | null;
}) {
  const body = (
    <>
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-fg-secondary">{hint}</span> : null}
    </>
  );
  const className =
    "flex flex-col gap-0.5 rounded-lg border border-border-subtle bg-surface px-3 py-2";
  return href ? (
    <Link href={href} className={`${className} hover:border-border-strong`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
