import { definePropertyRoute } from "@/lib/http/route";
import { dashboardParamsSchema } from "@/modules/reports/reports.schema";
import { getDashboard } from "@/modules/reports/reports.service";

/** Property KPIs: today live, the last closed date and a 30-day trend. */
export const GET = definePropertyRoute({
  permission: "dashboard:read",
  params: dashboardParamsSchema,
  handler: ({ ctx }) => getDashboard(ctx),
});
