import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { arrivalsQuerySchema } from "@/modules/front-desk/front-desk.schema";
import { listArrivals } from "@/modules/front-desk/front-desk.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Due-in reservation rooms for the business date (pending and checked in today). */
export const GET = definePropertyRoute({
  permission: "frontdesk:read",
  params: propertyParamsSchema,
  query: arrivalsQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listArrivals(ctx, query);
    return withMeta(items, meta);
  },
});
