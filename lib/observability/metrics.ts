import "server-only";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

/**
 * Process metrics in the Prometheus text format (0.0.4), which the
 * OpenTelemetry Collector's `prometheus` receiver and Prometheus itself scrape
 * (docs/OPERATIONS.md §11, docs/SCALABILITY.md §38). Names follow the
 * OpenTelemetry semantic conventions where one exists
 * (`http.server.request.duration` → `http_server_request_duration_seconds`).
 *
 * No SDK and no exporter: one in-memory registry per process, rendered on
 * scrape. It lives on globalThis because the instrumentation bundle (job
 * worker) and the route bundles each load this module; both record into the
 * same registry.
 *
 * Labels are bounded and never personal: route templates (ids replaced),
 * methods, status codes, job kinds, rate-limit rule names, pool names. No
 * tokens, addresses, names, amounts or query text.
 */

type Labels = Record<string, string>;
type Sample = { labels: Labels; value: number };
type Collector = () => Sample[] | Promise<Sample[]>;

interface CounterState {
  type: "counter";
  help: string;
  series: Map<string, Sample>;
}
interface HistogramState {
  type: "histogram";
  help: string;
  buckets: number[];
  series: Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>;
}
interface GaugeState {
  type: "gauge";
  help: string;
  collect: Collector;
}
type Metric = CounterState | HistogramState | GaugeState;

/** Series per metric before new label sets fold into one `overflow="true"` series. */
const MAX_SERIES = 1_000;

const holder = globalThis as unknown as { __sereneMetrics?: Map<string, Metric> };
function registry(): Map<string, Metric> {
  holder.__sereneMetrics ??= new Map();
  return holder.__sereneMetrics;
}

function keyOf(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(",");
}

function seriesFor<T>(series: Map<string, T>, labels: Labels, create: (l: Labels) => T): T {
  const key = keyOf(labels);
  let entry = series.get(key);
  if (!entry) {
    const capped = series.size >= MAX_SERIES;
    const finalLabels = capped ? { overflow: "true" } : labels;
    const finalKey = capped ? "overflow=true" : key;
    entry = series.get(finalKey) ?? create(finalLabels);
    series.set(finalKey, entry);
  }
  return entry;
}

export interface Counter {
  inc(labels?: Labels, by?: number): void;
}

export function counter(name: string, help: string): Counter {
  const map = registry();
  if (!map.has(name)) map.set(name, { type: "counter", help, series: new Map() });
  const state = map.get(name) as CounterState;
  return {
    inc(labels = {}, by = 1) {
      seriesFor(state.series, labels, (l) => ({ labels: l, value: 0 })).value += by;
    },
  };
}

export interface Histogram {
  observe(labels: Labels, value: number): void;
}

export const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
] as const;
export const WAIT_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;

export function histogram(
  name: string,
  help: string,
  buckets: readonly number[] = DURATION_BUCKETS,
): Histogram {
  const map = registry();
  if (!map.has(name)) {
    map.set(name, { type: "histogram", help, buckets: [...buckets], series: new Map() });
  }
  const state = map.get(name) as HistogramState;
  return {
    observe(labels, value) {
      const entry = seriesFor(state.series, labels, (l) => ({
        labels: l,
        counts: state.buckets.map(() => 0),
        sum: 0,
        count: 0,
      }));
      for (let i = 0; i < state.buckets.length; i++) {
        if (value <= state.buckets[i]!) entry.counts[i]! += 1;
      }
      entry.sum += value;
      entry.count += 1;
    },
  };
}

/** A gauge read on scrape. Registering the same name again replaces the collector. */
export function gauge(name: string, help: string, collect: Collector): void {
  registry().set(name, { type: "gauge", help, collect });
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labelText(labels: Labels, extra?: [string, string]): string {
  const pairs = Object.entries(labels);
  if (extra) pairs.push(extra);
  if (pairs.length === 0) return "";
  return `{${pairs.map(([k, v]) => `${k}="${escape(v)}"`).join(",")}}`;
}

function number(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "+Inf";
  return String(Math.round(value * 1e6) / 1e6);
}

/** The whole registry as Prometheus text. A failing gauge is skipped, never fatal. */
export async function renderMetrics(): Promise<string> {
  const lines: string[] = [];
  for (const [name, metric] of [...registry()].sort(([a], [b]) => a.localeCompare(b))) {
    if (metric.type === "gauge") {
      let samples: Sample[];
      try {
        samples = await metric.collect();
      } catch {
        continue;
      }
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} gauge`);
      for (const s of samples) lines.push(`${name}${labelText(s.labels)} ${number(s.value)}`);
    } else if (metric.type === "counter") {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} counter`);
      for (const s of metric.series.values()) {
        lines.push(`${name}${labelText(s.labels)} ${number(s.value)}`);
      }
    } else {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} histogram`);
      for (const s of metric.series.values()) {
        metric.buckets.forEach((le, i) =>
          lines.push(`${name}_bucket${labelText(s.labels, ["le", String(le)])} ${s.counts[i]}`),
        );
        lines.push(`${name}_bucket${labelText(s.labels, ["le", "+Inf"])} ${s.count}`);
        lines.push(`${name}_sum${labelText(s.labels)} ${number(s.sum)}`);
        lines.push(`${name}_count${labelText(s.labels)} ${s.count}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

/** Test seam: an empty registry. */
export function resetMetricsForTests(): void {
  holder.__sereneMetrics = new Map();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A bounded, non-personal route label from a request path: ids become `{id}`
 * and any segment that is not a plain lower-case word becomes `{param}`
 * (every dynamic API segment is a UUID or a fixed report key).
 */
export function routeTemplate(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) =>
      segment === ""
        ? ""
        : UUID.test(segment)
          ? "{id}"
          : /^[a-z][a-z0-9-]{0,40}$/.test(segment)
            ? segment
            : "{param}",
    )
    .join("/");
}

// --- Request metrics (lib/http/route.ts) -------------------------------------------------

const requestDuration = () =>
  histogram(
    "http_server_request_duration_seconds",
    "API request duration by method, route template and status (event streams: until the response starts)",
  );

export function recordRequest(method: string, pathname: string, status: number, seconds: number) {
  requestDuration().observe(
    { method, route: routeTemplate(pathname), status: String(status) },
    seconds,
  );
}

// --- Process metrics ----------------------------------------------------------------------

interface ProcessState {
  loop: IntervalHistogram;
  window: { p50: number; p99: number; max: number };
  timer: ReturnType<typeof setInterval>;
}
const processHolder = globalThis as unknown as { __sereneProcessMetrics?: ProcessState };

/**
 * CPU, memory, uptime and event-loop delay of this process. Event-loop delay
 * is reported over the last 15 s window (p50, p99, max), so one scraper or
 * several see the same values.
 */
export function startProcessMetrics(): void {
  if (processHolder.__sereneProcessMetrics) return;
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const state: ProcessState = {
    loop,
    window: { p50: 0, p99: 0, max: 0 },
    timer: setInterval(() => {
      state.window = {
        p50: loop.percentile(50) / 1e9,
        p99: loop.percentile(99) / 1e9,
        max: loop.max / 1e9,
      };
      loop.reset();
    }, 15_000),
  };
  state.timer.unref?.();
  processHolder.__sereneProcessMetrics = state;

  gauge("process_cpu_seconds_total", "CPU time used by this process (user + system)", () => {
    const used = process.cpuUsage();
    return [{ labels: {}, value: (used.user + used.system) / 1e6 }];
  });
  gauge("process_resident_memory_bytes", "Resident set size", () => [
    { labels: {}, value: process.memoryUsage().rss },
  ]);
  gauge("nodejs_heap_used_bytes", "V8 heap in use", () => [
    { labels: {}, value: process.memoryUsage().heapUsed },
  ]);
  gauge("process_uptime_seconds", "Seconds since this process started", () => [
    { labels: {}, value: process.uptime() },
  ]);
  gauge("nodejs_eventloop_delay_seconds", "Event-loop delay over the last 15 s window", () => [
    { labels: { quantile: "0.5" }, value: state.window.p50 },
    { labels: { quantile: "0.99" }, value: state.window.p99 },
    { labels: { quantile: "1" }, value: state.window.max },
  ]);
}
