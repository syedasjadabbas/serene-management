import { definePropertyRoute } from "@/lib/http/route";
import { nightAuditRunParamsSchema } from "@/modules/night-audit/night-audit.schema";
import { getRun } from "@/modules/night-audit/night-audit.service";

/** One run with its steps and summary. */
export const GET = definePropertyRoute({
  permission: "nightaudit:read",
  params: nightAuditRunParamsSchema,
  handler: ({ ctx, params }) => getRun(ctx, params.runId),
});
