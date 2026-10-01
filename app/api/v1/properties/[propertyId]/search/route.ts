import { addServerTiming, definePropertyRoute, serverTimingEnabled } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { globalSearchQuerySchema } from "@/modules/search/search.schema";
import { searchProperty } from "@/modules/search/search.service";

/**
 * Global search in one property: every record type the user may read here,
 * in one request (docs/SCALABILITY.md §28). Each type is permission-checked
 * by the service; no single permission gates the route.
 */
export const GET = definePropertyRoute({
  params: propertyParamsSchema,
  query: globalSearchQuerySchema,
  handler: ({ request, ctx, query }) =>
    searchProperty(ctx, query.q, {
      onTiming: serverTimingEnabled()
        ? (type, ms) => addServerTiming(request, `search-${type}`, ms)
        : undefined,
    }),
});
