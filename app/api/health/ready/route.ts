import { NextResponse } from "next/server";
import { definePublicRoute, serverTimingEnabled } from "@/lib/http/route";
import { instanceStatus } from "@/lib/lifecycle/status";
import { isDraining } from "@/lib/lifecycle/shutdown";
import { isDatabaseReady } from "@/modules/access/access.service";

/**
 * Readiness (L28, docs/OPERATIONS.md §10): this instance should receive
 * traffic. 503 while PostgreSQL does not answer within 2 s, and from the
 * moment a shutdown signal arrives (draining), so a load balancer takes the
 * instance out without the process being restarted. Never reveals the
 * underlying error. With SERVER_TIMING=1 (load tests, multi-instance QA) the
 * body also carries the instance's status: identifier, uptime, in-flight
 * requests, live updates and job worker (no addresses, no secrets).
 */
export const GET = definePublicRoute({
  handler: async () => {
    const draining = isDraining();
    const ready = !draining && (await isDatabaseReady());
    const status = draining ? "draining" : ready ? "ready" : "unavailable";
    const body = serverTimingEnabled() ? { status, ...instanceStatus() } : { status };
    return ready ? body : NextResponse.json(body, { status: 503 });
  },
});
