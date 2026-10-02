import { definePublicRoute } from "@/lib/http/route";

/**
 * Liveness (L28, docs/OPERATIONS.md §10): the process is up and answering. No
 * database access, no details, and still 200 while draining or while the
 * database is down: an orchestrator restarts the process only when this
 * fails, and a database outage must not get healthy processes restarted.
 */
export const GET = definePublicRoute({
  handler: async () => ({ status: "ok" }),
});
