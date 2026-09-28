import { NextResponse } from "next/server";
import { definePublicRoute } from "@/lib/http/route";
import { isDatabaseReady } from "@/modules/access/access.service";

/**
 * Readiness (L28): the app can serve requests (PostgreSQL answers within 2 s).
 * 503 while the database is unavailable, so traffic is held back without the
 * process being restarted. Never reveals the underlying error.
 */
export const GET = definePublicRoute({
  handler: async () =>
    (await isDatabaseReady())
      ? { status: "ready" }
      : NextResponse.json({ status: "unavailable" }, { status: 503 }),
});
