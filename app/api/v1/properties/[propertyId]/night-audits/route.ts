import { definePropertyRoute, withMeta } from "@/lib/http/route";
import {
  nightAuditParamsSchema,
  nightAuditRunsQuerySchema,
  startNightAuditSchema,
} from "@/modules/night-audit/night-audit.schema";
import { listRuns, startNightAudit } from "@/modules/night-audit/night-audit.service";

/** Night-audit run history, newest first. */
export const GET = definePropertyRoute({
  permission: "nightaudit:read",
  params: nightAuditParamsSchema,
  query: nightAuditRunsQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listRuns(ctx, query);
    return withMeta(items, meta);
  },
});

/**
 * Runs night audit for the current business date (high-risk, reason and
 * Idempotency-Key required). Answers the run: COMPLETED, or FAILED with the
 * step and reason (nothing posted, the date still open).
 */
export const POST = definePropertyRoute({
  permission: "nightaudit:run",
  params: nightAuditParamsSchema,
  body: startNightAuditSchema,
  idempotent: true,
  rateLimit: { name: "nightaudit.start", limit: 10, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, body, idempotency }) => startNightAudit(ctx, body, idempotency),
});
