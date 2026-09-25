import { definePropertyRoute } from "@/lib/http/route";
import {
  nightAuditRunParamsSchema,
  recoverNightAuditSchema,
} from "@/modules/night-audit/night-audit.schema";
import { recoverRun } from "@/modules/night-audit/night-audit.service";

/** Recovers a run left RUNNING by an interruption (high-risk, reason required). */
export const POST = definePropertyRoute({
  permission: "nightaudit:run",
  params: nightAuditRunParamsSchema,
  body: recoverNightAuditSchema,
  handler: ({ ctx, params, body }) => recoverRun(ctx, params.runId, body),
});
