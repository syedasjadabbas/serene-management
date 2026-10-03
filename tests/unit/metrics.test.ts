import { afterEach, describe, expect, it } from "vitest";
import {
  counter,
  gauge,
  histogram,
  recordRequest,
  renderMetrics,
  resetMetricsForTests,
  routeTemplate,
  startProcessMetrics,
} from "@/lib/observability/metrics";
import { parseServerEnv } from "@/lib/env";

afterEach(() => resetMetricsForTests());

describe("route templates (bounded, non-personal metric labels)", () => {
  it("replaces ids and anything that is not a plain lower-case word", () => {
    expect(
      routeTemplate(
        "/api/v1/properties/01890a5d-ac96-774b-bcce-b302099a8057/reservations/01890a5d-ac96-774b-bcce-b302099a8058/check-in",
      ),
    ).toBe("/api/v1/properties/{id}/reservations/{id}/check-in");
    expect(routeTemplate("/api/v1/properties/{x}/reports/guest-ledger")).toBe(
      "/api/v1/properties/{param}/reports/guest-ledger",
    );
    // Never a name, an e-mail or a code that came from the user.
    expect(routeTemplate("/api/v1/guests/Jane.Doe@mail.test")).toBe("/api/v1/guests/{param}");
    expect(routeTemplate("/api/v1/x/SMR")).toBe("/api/v1/x/{param}");
  });

  it("names parameter segments, so made-up values cannot mint new labels (P2-10)", () => {
    expect(
      routeTemplate("/api/v1/properties/01890a5d-ac96-774b-bcce-b302099a8057/reports/made-up", {
        propertyId: "01890a5d-ac96-774b-bcce-b302099a8057",
        reportKey: "made-up",
      }),
    ).toBe("/api/v1/properties/{id}/reports/{reportKey}");
    expect(routeTemplate("/api/v1/guests/abc", { guestId: "abc" })).toBe(
      "/api/v1/guests/{guestId}",
    );
    // Fixed segments stay as they are.
    expect(routeTemplate("/api/v1/auth/sessions", {})).toBe("/api/v1/auth/sessions");
  });
});

describe("metrics registry (Prometheus text format)", () => {
  it("renders counters, histograms with cumulative buckets, and gauges", async () => {
    counter("demo_total", "Demo").inc({ kind: "a" });
    counter("demo_total", "Demo").inc({ kind: "a" }, 2);
    const h = histogram("demo_seconds", "Demo time", [0.1, 1]);
    h.observe({ op: "x" }, 0.05);
    h.observe({ op: "x" }, 0.5);
    h.observe({ op: "x" }, 5);
    gauge("demo_gauge", "Demo gauge", () => [{ labels: { pool: "p" }, value: 3 }]);
    const text = await renderMetrics();
    expect(text).toContain('# TYPE demo_total counter\ndemo_total{kind="a"} 3');
    expect(text).toContain('demo_seconds_bucket{op="x",le="0.1"} 1');
    expect(text).toContain('demo_seconds_bucket{op="x",le="1"} 2');
    expect(text).toContain('demo_seconds_bucket{op="x",le="+Inf"} 3');
    expect(text).toContain('demo_seconds_count{op="x"} 3');
    expect(text).toContain('demo_gauge{pool="p"} 3');
  });

  it("records requests by route template and status, never the raw path", async () => {
    recordRequest("GET", "/api/v1/jobs/01890a5d-ac96-774b-bcce-b302099a8057", 404, 0.02);
    const text = await renderMetrics();
    expect(text).toContain(
      'http_server_request_duration_seconds_count{method="GET",route="/api/v1/jobs/{id}",status="404"} 1',
    );
    expect(text).not.toContain("01890a5d");
  });

  it("caps the series of one metric instead of growing without bound", async () => {
    const c = counter("wide_total", "Wide");
    for (let i = 0; i < 1_100; i++) c.inc({ n: String(i) });
    const lines = (await renderMetrics()).split("\n").filter((l) => l.startsWith("wide_total"));
    expect(lines.length).toBe(1_001);
    expect(lines).toContain('wide_total{overflow="true"} 100');
  });

  it("skips a gauge whose collector fails (e.g. the database is down)", async () => {
    gauge("broken", "Broken", () => {
      throw new Error("down");
    });
    gauge("fine", "Fine", () => [{ labels: {}, value: 1 }]);
    const text = await renderMetrics();
    expect(text).not.toContain("broken");
    expect(text).toContain("fine 1");
  });

  it("reports CPU, memory, uptime and event-loop delay", async () => {
    startProcessMetrics();
    const text = await renderMetrics();
    for (const name of [
      "process_cpu_seconds_total",
      "process_resident_memory_bytes",
      "nodejs_heap_used_bytes",
      "process_uptime_seconds",
      'nodejs_eventloop_delay_seconds{quantile="0.99"}',
    ]) {
      expect(text).toContain(name);
    }
  });
});

describe("METRICS_TOKEN", () => {
  const prod = {
    NODE_ENV: "production",
    APP_URL: "https://pms.example-hotel.com",
    DATABASE_URL: "postgresql://serene:Xk2-real-Pw9@db:5432/serene",
    AUTH_ACCESS_TOKEN_SECRET: "q8Zr2Lw0Pf6Ys1Nd4Kj7Hb3Tm9Vc5Xa0Ge",
    AUTH_REFRESH_TOKEN_SECRET: "W1sE9rT4yU7iO2pA5sD8fG3hJ6kL0zXcVb",
    TRUSTED_PROXY_HOPS: "1",
  };
  it("is optional, and refused in production when short or a placeholder", () => {
    expect(parseServerEnv(prod).success).toBe(true);
    expect(parseServerEnv({ ...prod, METRICS_TOKEN: "short" }).success).toBe(false);
    expect(parseServerEnv({ ...prod, METRICS_TOKEN: "change-me-".repeat(4) }).success).toBe(false);
    expect(
      parseServerEnv({ ...prod, METRICS_TOKEN: "Pq7Lm2Zx9Rt4Wv8Bn3Kc6Hd1Fs5Gy0Ja" }).success,
    ).toBe(true);
  });
});
