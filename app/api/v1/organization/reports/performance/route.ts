import { defineSessionRoute } from "@/lib/http/route";
import { organizationPerformanceQuerySchema } from "@/modules/organization/organization.schema";
import { organizationPerformance } from "@/modules/organization/organization.service";

/** Occupancy and revenue per property and per currency, never converted (D4, D38). */
export const GET = defineSessionRoute({
  query: organizationPerformanceQuerySchema,
  rateLimit: { name: "reports.run", limit: 120, windowMs: 60_000 },
  handler: ({ ctx, query }) => organizationPerformance(ctx, query),
});
