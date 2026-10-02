import { NextResponse } from "next/server";
import { definePublicRoute } from "@/lib/http/route";
import { isDraining } from "@/lib/lifecycle/shutdown";
import { isDatabaseReady } from "@/modules/access/access.service";

/**
 * Kept for existing probes: the same check as /api/health/ready (database,
 * and 503 while draining). New deployments should probe /api/health/live for
 * liveness and /api/health/ready for readiness.
 */
export const GET = definePublicRoute({
  handler: async () =>
    !isDraining() && (await isDatabaseReady())
      ? { status: "ready" }
      : NextResponse.json({ status: isDraining() ? "draining" : "unavailable" }, { status: 503 }),
});
