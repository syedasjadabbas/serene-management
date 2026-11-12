import { timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import { serverEnv } from "@/config/env";
import { notFound } from "@/lib/customError";
import { handle } from "@/lib/controller";
import { isDraining } from "@/lib/lifecycle/shutdown";
import { instanceStatus } from "@/lib/lifecycle/status";
import { renderMetrics } from "@/lib/observability/metrics";
import { serverTimingEnabled } from "@/middlewares/observe";
import { isDatabaseReady } from "@/modules/access/access.service";

/**
 * Liveness (L28, docs/OPERATIONS.md section 10): the process is up and
 * answering. No database access, no details, and still 200 while draining or
 * while the database is down: an orchestrator restarts the process only when
 * this fails, and a database outage must not get healthy processes restarted.
 */
export const live = handle(() => ({ status: "ok" }));

/**
 * 503 in the error envelope, with the probe's `data.status` kept so a human
 * (or the client's connectivity probe) can tell draining from unavailable.
 */
function notReady(res: Response, body: { status: string }) {
  res.status(503).json({
    success: false,
    message: body.status === "draining" ? "Shutting down" : "Not ready",
    data: body,
    error: { code: "INTERNAL_ERROR", requestId: res.locals.requestId },
  });
}

/**
 * Readiness: this instance should receive traffic. 503 while PostgreSQL does
 * not answer within 2 s, and from the moment a shutdown signal arrives
 * (draining), so a load balancer takes the instance out without the process
 * being restarted. Never reveals the underlying error. With SERVER_TIMING=1
 * the body also carries the instance's status (identifier, uptime, in-flight
 * requests, live updates, job worker).
 */
export const ready = handle(async (_req, res) => {
  const draining = isDraining();
  const isReady = !draining && (await isDatabaseReady());
  const status = draining ? "draining" : isReady ? "ready" : "unavailable";
  const body = serverTimingEnabled() ? { status, ...instanceStatus() } : { status };
  if (!isReady) return notReady(res, body);
  return body;
});

/** Kept for existing probes: the same check as /api/health/ready. */
export const legacyHealth = handle(async (_req, res) => {
  if (!isDraining() && (await isDatabaseReady())) return { status: "ready" };
  return notReady(res, { status: isDraining() ? "draining" : "unavailable" });
});

/**
 * This process's metrics in the Prometheus text format. Internal: 404 unless
 * METRICS_TOKEN is set and sent as a bearer token. The output holds no tokens,
 * addresses, personal or financial data (lib/observability/metrics.ts).
 */
export const metrics = handle(async (req, res) => {
  const token = serverEnv().METRICS_TOKEN;
  const sent = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1] ?? "";
  const expected = Buffer.from(token ?? "");
  const given = Buffer.from(sent);
  if (!token || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw notFound("Page");
  }
  res.type("text/plain; version=0.0.4; charset=utf-8").send(await renderMetrics());
});
