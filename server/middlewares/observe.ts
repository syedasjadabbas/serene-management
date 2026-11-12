import type { Request, RequestHandler } from "express";
import { serverEnv } from "@/config/env";
import { type PoolUsage, withPoolUsage } from "@/lib/db/pool-metrics";
import { instanceId, trackRequest } from "@/lib/lifecycle/shutdown";
import { recordRequest, routeTemplate } from "@/lib/observability/metrics";

/**
 * Request observability (second middleware, right after requestId):
 *  - counts the request as in flight for the graceful shutdown,
 *  - records its pool usage (Server-Timing, slow-request log),
 *  - records the duration metric (GET /api/metrics) when the response ends,
 *  - logs one line for a slow request: request id, instance, route template,
 *    status, timings. Never the path's ids, the query string, the body or the user.
 * Opt-in `Server-Timing` (SERVER_TIMING=1) as before.
 */

const extraTimings = new WeakMap<Request, string[]>();

export function serverTimingEnabled(): boolean {
  return serverEnv().SERVER_TIMING === "1";
}

/** Adds `name;dur=…` to this request's opt-in Server-Timing header (no-op when off). */
export function addServerTiming(req: Request, name: string, ms: number): void {
  if (!serverTimingEnabled() || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name)) return;
  const list = extraTimings.get(req) ?? [];
  list.push(`${name};dur=${ms.toFixed(1)}`);
  extraTimings.set(req, list);
}

function serverTiming(req: Request, started: number, pool: PoolUsage): string {
  const total = performance.now() - started;
  return [
    ...(extraTimings.get(req) ?? []),
    // Waiting for pooled connections; desc: checkouts / newly opened connections.
    `db-acquire;dur=${pool.waitMs.toFixed(1)};desc="${pool.acquisitions}/${pool.opened}"`,
    ...(Object.keys(pool.reads).length > 0
      ? [
          `db-read;desc="${Object.entries(pool.reads)
            .map(([route, count]) => `${route}=${count}`)
            .join(" ")}"`,
        ]
      : []),
    `total;dur=${total.toFixed(1)}`,
  ].join(", ");
}

export const observe: RequestHandler = (req, res, next) => {
  const started = performance.now();
  const pool: PoolUsage = { waitMs: 0, acquisitions: 0, opened: 0, reads: {} };

  if (serverTimingEnabled()) {
    res.setHeader("x-instance-id", instanceId());
    // Headers must be set before they are sent: patch writeHead.
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => typeof res;
    res.writeHead = ((...args: unknown[]) => {
      if (!res.headersSent) res.setHeader("server-timing", serverTiming(req, started, pool));
      return writeHead(...args);
    }) as typeof res.writeHead;
  }

  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    done = resolve;
  });
  let observed = false;
  const record = () => {
    if (observed) return;
    observed = true;
    const ms = performance.now() - started;
    const status = res.statusCode;
    const params = (req.params ?? {}) as Record<string, unknown>;
    const pathname = req.originalUrl.split("?")[0] ?? req.path;
    recordRequest(req.method, pathname, status, ms / 1000, params);
    const slow = serverEnv().SLOW_REQUEST_MS;
    if (slow > 0 && ms >= slow) {
      console.warn(
        JSON.stringify({
          msg: "slow request",
          requestId: req.meta.requestId,
          instance: instanceId(),
          method: req.method,
          route: routeTemplate(pathname, params),
          status,
          ms: Math.round(ms),
          dbWaitMs: Math.round(pool.waitMs),
          dbCheckouts: pool.acquisitions,
        }),
      );
    }
  };
  // "finish": response written; "close": connection ended (event streams, aborts).
  res.on("finish", record);
  res.on("close", () => {
    record();
    done();
  });

  // Counted for the graceful shutdown (lib/lifecycle/shutdown.ts); the pool
  // usage store follows the request through every await below.
  void trackRequest(() =>
    withPoolUsage(pool, async () => {
      next();
      await finished;
    }),
  );
};
