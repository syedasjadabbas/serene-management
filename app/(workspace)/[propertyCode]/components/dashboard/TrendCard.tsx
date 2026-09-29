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
import { StatusPanel } from "@/components/ui/StatusPanel";
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
 * alternative: average, latest and range.
 */
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

  return (
    <Card title="Occupancy trend" description={summary ?? "Last closed business dates"}>
      {points.length > 1 ? (
        <div aria-hidden="true" className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
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
      ) : (
        <StatusPanel
          kind="empty"
          title="No trend yet"
          description="The trend appears once night audit has closed at least two business dates."
        />
      )}
    </Card>
  );
}
