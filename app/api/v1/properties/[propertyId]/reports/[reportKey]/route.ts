import { definePropertyRoute } from "@/lib/http/route";
import { reportParamsSchema, reportQuerySchema } from "@/modules/reports/reports.schema";
import { runReport } from "@/modules/reports/reports.service";

/** Runs one report; the report's own permission is checked by the service. */
export const GET = definePropertyRoute({
  params: reportParamsSchema,
  query: reportQuerySchema,
  rateLimit: { name: "reports.run", limit: 120, windowMs: 60_000 },
  handler: ({ ctx, params, query }) => runReport(ctx, params.reportKey, query),
});
