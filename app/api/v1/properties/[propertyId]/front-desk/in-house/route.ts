import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { inHouseQuerySchema } from "@/modules/front-desk/front-desk.schema";
import { listInHouse } from "@/modules/front-desk/front-desk.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "frontdesk:read",
  params: propertyParamsSchema,
  query: inHouseQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listInHouse(ctx, query);
    return withMeta(items, meta);
  },
});
