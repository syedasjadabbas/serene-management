import { definePropertyRoute } from "@/lib/http/route";
import { reportParamsSchema, reportQuerySchema } from "@/modules/reports/reports.schema";
import { exportReport } from "@/modules/reports/reports.service";

/** CSV download (reports:export plus the report's own permission). */
export const GET = definePropertyRoute({
  permission: "reports:export",
  params: reportParamsSchema,
  query: reportQuerySchema,
  rateLimit: { name: "reports.export", limit: 30, windowMs: 60_000 },
  handler: ({ ctx, params, query }) => exportReport(ctx, params.reportKey, query),
});
