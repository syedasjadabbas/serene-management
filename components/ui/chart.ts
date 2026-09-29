/**
 * Recharts styling bound to the SERENE chart tokens (app/globals.css), so
 * charts follow the theme without JavaScript colour logic. Series use
 * CHART_SERIES in order; one series per chart uses the brand colour. Axis
 * text is 11px muted, gridlines are horizontal hairlines only, and the
 * tooltip is a raised surface. Every chart also needs a text alternative
 * (a caption, a summary or the same figures in a table).
 */
export const CHART_SERIES = [
  "var(--sm-chart-1)",
  "var(--sm-chart-2)",
  "var(--sm-chart-3)",
  "var(--sm-chart-4)",
  "var(--sm-chart-5)",
] as const;

export const chartAxisProps = {
  tick: { fill: "var(--sm-chart-axis)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--sm-chart-grid)" },
} as const;

export const chartGridProps = {
  stroke: "var(--sm-chart-grid)",
  strokeDasharray: "0",
  vertical: false,
} as const;

export const chartTooltipProps = {
  contentStyle: {
    background: "var(--sm-surface-raised)",
    border: "1px solid var(--sm-border-subtle)",
    borderRadius: 6,
    boxShadow: "var(--sm-shadow-raised)",
    color: "var(--sm-fg)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--sm-fg-secondary)", marginBottom: 2 },
  cursor: { stroke: "var(--sm-border-strong)", strokeWidth: 1 },
} as const;
