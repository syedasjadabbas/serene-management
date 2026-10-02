"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { ChartLine } from "lucide-react";
import {
  CHART_SERIES,
  chartAxisProps,
  chartGridProps,
  chartTooltipProps,
} from "@/components/ui/chart";
import type { DashboardView } from "@/modules/reports/reports.types";
import { formatShortDate } from "@/lib/utils/format";

/**
 * Occupancy of the last closed business dates (night-audit snapshots,
 * oldest first). The sentence under the title is the chart's text
 * alternative: average, latest and range. Until two dates are closed there
 * is no trend: the card is then a single compact line (the dashboard gives
 * it a full-width slot instead of a paired column).
 */
export function hasTrend(trend: DashboardView["trend"]) {
  return trend.length > 1;
}

export function TrendCard({ trend }: { trend: DashboardView["trend"] }) {
  const points = trend.map((t) => ({ date: t.businessDate, occupancy: Number(t.occupancy) }));
  const values = points.map((p) => p.occupancy);
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const pct = (value: number) => `${value.toFixed(1)}%`;
  const latest = values[values.length - 1] ?? 0;
  const summary =
    points.length > 1
      ? `Average ${pct(average)} over ${points.length} closed dates; latest ${pct(latest)}, ` +
        `range ${pct(Math.min(...values))}–${pct(Math.max(...values))}.`
      : undefined;

  if (points.length < 2) {
    return (
      <section
        aria-labelledby="trend-empty-title"
        className="flex items-center gap-4 rounded-lg border border-border-subtle bg-surface px-5 py-4 shadow-card sm:px-6"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface-sunken text-fg-muted"
        >
          <ChartLine className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="trend-empty-title" className="text-sm font-semibold text-fg">
            Occupancy trend
          </h2>
          <p className="text-sm text-fg-secondary">
            No trend yet: it appears once night audit has closed at least two business dates.
          </p>
        </div>
      </section>
    );
  }

  return (
    <Card title="Occupancy trend" description={summary ?? "Last closed business dates"}>
      {points.length > 1 ? (
        <div aria-hidden="true" className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
              accessibilityLayer={false}
            >
              <CartesianGrid {...chartGridProps} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => formatShortDate(d)}
                minTickGap={24}
                {...chartAxisProps}
              />
              <YAxis domain={[0, 100]} unit="%" width={44} {...chartAxisProps} />
              <Tooltip
                formatter={(value) => [`${value}%`, "Occupancy"]}
                labelFormatter={(label) => formatShortDate(String(label))}
                {...chartTooltipProps}
              />
              <Area
                type="monotone"
                dataKey="occupancy"
                stroke={CHART_SERIES[0]}
                strokeWidth={2}
                fill={CHART_SERIES[0]}
                fillOpacity={0.1}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </Card>
  );
}
