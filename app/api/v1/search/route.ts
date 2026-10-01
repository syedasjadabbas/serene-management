import { addServerTiming, defineSessionRoute, serverTimingEnabled } from "@/lib/http/route";
import { globalSearchQuerySchema } from "@/modules/search/search.schema";
import { searchOrganization } from "@/modules/search/search.service";

/**
 * Global search in the organization workspace: guest and company profiles
 * (each checked by the service), in one request (docs/SCALABILITY.md §28).
 */
export const GET = defineSessionRoute({
  query: globalSearchQuerySchema,
  handler: ({ request, ctx, session, query }) =>
    searchOrganization(ctx, session.properties, query.q, {
      onTiming: serverTimingEnabled()
        ? (type, ms) => addServerTiming(request, `search-${type}`, ms)
        : undefined,
    }),
});
