import { definePropertyRoute, withMeta } from "@/lib/http/route";
import { createGroupSchema, groupsQuerySchema } from "@/modules/groups/groups.schema";
import { createGroup, listGroups } from "@/modules/groups/groups.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "groups:read",
  params: propertyParamsSchema,
  query: groupsQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, nextCursor } = await listGroups(ctx, query);
    return withMeta(items, { nextCursor, limit: query.limit });
  },
});

export const POST = definePropertyRoute({
  permission: "groups:manage",
  params: propertyParamsSchema,
  body: createGroupSchema,
  status: 201,
  handler: ({ ctx, body }) => createGroup(ctx, body),
});
