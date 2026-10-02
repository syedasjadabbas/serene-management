import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as readyRoute } from "@/app/api/health/ready/route";
import { GET as metricsRoute } from "@/app/api/metrics/route";
import { serverEnv } from "@/lib/env";
import { call } from "./support/http";

/**
 * Final scalability phase: the metrics endpoint, pool measurements, the
 * slow-request log and request-id correlation (docs/SCALABILITY.md §38).
 */
const env = serverEnv() as { METRICS_TOKEN?: string; SLOW_REQUEST_MS: number };
const saved = { token: env.METRICS_TOKEN, slow: env.SLOW_REQUEST_MS };
const TOKEN = "Pq7Lm2Zx9Rt4Wv8Bn3Kc6Hd1Fs5Gy0Ja-test";

afterEach(() => {
  env.METRICS_TOKEN = saved.token;
  env.SLOW_REQUEST_MS = saved.slow;
  vi.restoreAllMocks();
});

describe("GET /api/metrics", () => {
  it("does not exist without METRICS_TOKEN, or with a wrong token", async () => {
    env.METRICS_TOKEN = undefined;
    expect((await call(metricsRoute, { path: "/api/metrics" })).status).toBe(404);
    env.METRICS_TOKEN = TOKEN;
    expect((await call(metricsRoute, { path: "/api/metrics" })).status).toBe(404);
    const wrong = await call(metricsRoute, {
      path: "/api/metrics",
      headers: { authorization: `Bearer ${TOKEN.slice(0, -1)}x` },
    });
    expect(wrong.status).toBe(404);
  });

  it("reports requests, pool waits and connection use after real database work", async () => {
    env.METRICS_TOKEN = TOKEN;
    expect((await call(readyRoute, { path: "/api/health/ready" })).status).toBe(200);
    const res = await call<string>(metricsRoute, {
      path: "/api/metrics",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.response.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    const text = res.body;
    expect(text).toMatch(
      /http_server_request_duration_seconds_count\{method="GET",route="\/api\/health\/ready",status="200"\} \d+/,
    );
    expect(text).toMatch(/db_client_connection_wait_seconds_count\{pool="primary"\} [1-9]/);
    expect(text).toMatch(/db_client_connection_use_seconds_count\{pool="primary"\} [1-9]/);
    expect(text).toMatch(/db_client_connection_max\{pool="primary"\} \d+/);
    expect(text).toMatch(/db_client_connection_pending_requests\{pool="primary"\} 0/);
    // Nothing secret or personal in the output.
    expect(text).not.toMatch(/postgres(ql)?:\/\/|password|@[\w-]+\.\w|Bearer/i);
    expect(text).not.toContain(TOKEN);
  });
});

describe("request correlation and the slow-request log", () => {
  it("uses the load balancer's X-Request-Id, else a traceparent's trace id", async () => {
    const lb = await call(readyRoute, {
      path: "/api/health/ready",
      headers: { "x-request-id": "lb-7f3a9c21e5d84b06" },
    });
    expect(lb.response.headers.get("x-request-id")).toBe("lb-7f3a9c21e5d84b06");
    const traced = await call(readyRoute, {
      path: "/api/health/ready",
      headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
    });
    expect(traced.response.headers.get("x-request-id")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("logs one line per slow request: ids and timings, no address or user", async () => {
    env.SLOW_REQUEST_MS = 1;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await call(readyRoute, {
      path: "/api/health/ready",
      headers: { "x-request-id": "slow-0123456789abcdef" },
      ip: "203.0.113.77",
    });
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("slow request"));
    expect(line).toBeDefined();
    const entry = JSON.parse(line!);
    expect(entry).toMatchObject({
      msg: "slow request",
      requestId: "slow-0123456789abcdef",
      method: "GET",
      route: "/api/health/ready",
      status: 200,
    });
    expect(entry.dbCheckouts).toBeGreaterThanOrEqual(1);
    expect(line).not.toContain("203.0.113.77");
  });
});

describe("one database pool per process (final scalability phase)", () => {
  it("shares the pool with a second copy of the Prisma module, which cannot close it", async () => {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$queryRaw`SELECT 1`;
    const holder = globalThis as unknown as { __serenePrimaryPool?: { totalCount: number } };
    const pool = holder.__serenePrimaryPool;
    expect(pool).toBeDefined();
    // A second server bundle evaluates the module again (here: a fresh module
    // registry, without the development-only client cache).
    const cache = globalThis as unknown as { prisma?: unknown };
    const cached = cache.prisma;
    cache.prisma = undefined;
    vi.resetModules();
    const second = (await import("@/lib/db/prisma")).prisma;
    cache.prisma = cached;
    expect(second).not.toBe(prisma);
    expect(holder.__serenePrimaryPool).toBe(pool);
    await second.$queryRaw`SELECT 1`;
    // The copy that did not create the pool leaves it open for everyone else.
    await second.$disconnect();
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeDefined();
  });
});
