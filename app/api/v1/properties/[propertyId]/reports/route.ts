import { definePropertyRoute } from "@/lib/http/route";
import { reportsParamsSchema } from "@/modules/reports/reports.schema";
import { listReports } from "@/modules/reports/reports.service";

/** The reports this user may run at the property (filtered by permission). */
export const GET = definePropertyRoute({
  params: reportsParamsSchema,
  handler: async ({ ctx }) => listReports(ctx),
});
