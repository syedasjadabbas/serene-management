import { definePublicRoute } from "@/lib/http/route";

/**
 * Liveness (L28): the process is up and answering. No database access, no
 * details: an orchestrator restarts the process only when this fails.
 */
export const GET = definePublicRoute({
  handler: async () => ({ status: "ok" }),
});
