import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { notFound } from "@/lib/http/errors";
import { definePublicRoute } from "@/lib/http/route";
import { renderMetrics } from "@/lib/observability/metrics";

/**
 * This process's metrics in the Prometheus text format, for Prometheus or an
 * OpenTelemetry Collector (`prometheus` receiver). Scrape every instance
 * directly, not through the load balancer (docs/OPERATIONS.md §11).
 *
 * Internal: 404 unless METRICS_TOKEN is set and sent as a bearer token, so the
 * endpoint is invisible to everyone else. The output holds no tokens,
 * addresses, personal or financial data (lib/observability/metrics.ts).
 */
export const GET = definePublicRoute({
  handler: async ({ request }) => {
    const token = serverEnv().METRICS_TOKEN;
    const sent = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    const expected = Buffer.from(token ?? "");
    const given = Buffer.from(sent);
    if (!token || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw notFound("Page");
    }
    return new Response(await renderMetrics(), {
      headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
    });
  },
});
