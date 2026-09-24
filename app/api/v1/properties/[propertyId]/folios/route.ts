import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { folioListQuerySchema } from "@/modules/billing/billing.schema";
import { listFolios } from "@/modules/billing/billing.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Guest accounts: in-house stays, accounts with a balance, or every folio. */
export const GET = definePropertyRoute({
  permission: "billing:read",
  params: propertyParamsSchema,
  query: folioListQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, nextCursor } = await listFolios(ctx, query);
    return withMeta(items, { nextCursor, limit: query.limit });
  },
});
