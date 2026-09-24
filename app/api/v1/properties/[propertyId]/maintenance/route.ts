import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { createRequestSchema, requestsQuerySchema } from "@/modules/maintenance/maintenance.schema";
import { createRequest, listRequests } from "@/modules/maintenance/maintenance.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "maintenance:read",
  params: propertyParamsSchema,
  query: requestsQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, meta } = await listRequests(ctx, query);
    return withMeta(items, meta);
  },
});

/** Report an issue (optionally taking the room out of use: rooms:out_of_order + reason). */
export const POST = definePropertyRoute({
  permission: "maintenance:create",
  params: propertyParamsSchema,
  body: createRequestSchema,
  status: 201,
  handler: ({ ctx, body }) => createRequest(ctx, body),
});
