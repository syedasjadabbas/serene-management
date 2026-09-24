import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { departuresQuerySchema } from "@/modules/front-desk/front-desk.schema";
import { listDepartures } from "@/modules/front-desk/front-desk.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Due out (departure on or before the business date) and departed on the business date. */
export const GET = definePropertyRoute({
  permission: "frontdesk:read",
  params: propertyParamsSchema,
  query: departuresQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listDepartures(ctx, query);
    return withMeta(items, meta);
  },
});
