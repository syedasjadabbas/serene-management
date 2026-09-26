import { defineSessionRoute } from "@/lib/http/route";
import { getOrganizationOverview } from "@/modules/organization/organization.service";

/** One card per accessible property: business date, today's figures (Phase 9). */
export const GET = defineSessionRoute({
  handler: ({ ctx }) => getOrganizationOverview(ctx),
});
