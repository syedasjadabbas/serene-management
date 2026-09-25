import { definePropertyRoute } from "@/lib/http/route";
import { nightAuditParamsSchema } from "@/modules/night-audit/night-audit.schema";
import { getReadiness } from "@/modules/night-audit/night-audit.service";

/** The pre-audit checklist for the current business date (read-only). */
export const GET = definePropertyRoute({
  permission: "nightaudit:read",
  params: nightAuditParamsSchema,
  handler: ({ ctx }) => getReadiness(ctx),
});
