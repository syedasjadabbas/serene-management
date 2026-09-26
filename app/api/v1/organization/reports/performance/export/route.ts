import { defineSessionRoute } from "@/lib/http/route";
import { organizationPerformanceQuerySchema } from "@/modules/organization/organization.schema";
import { exportOrganizationPerformance } from "@/modules/organization/organization.service";

/** CSV of the organization performance report (reports:export; currencies kept apart). */
export const GET = defineSessionRoute({
  query: organizationPerformanceQuerySchema,
  rateLimit: { name: "reports.export", limit: 30, windowMs: 60_000 },
  handler: ({ ctx, query }) => exportOrganizationPerformance(ctx, query),
});
