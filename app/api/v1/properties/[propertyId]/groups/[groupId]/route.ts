import { definePropertyRoute } from "@/lib/http/route";
import { groupParamsSchema, updateGroupSchema } from "@/modules/groups/groups.schema";
import { getGroup, updateGroup } from "@/modules/groups/groups.service";

export const GET = definePropertyRoute({
  permission: "groups:read",
  params: groupParamsSchema,
  handler: ({ ctx, params }) => getGroup(ctx, params.groupId),
});

export const PATCH = definePropertyRoute({
  permission: "groups:manage",
  params: groupParamsSchema,
  body: updateGroupSchema,
  handler: ({ ctx, params, body }) => updateGroup(ctx, params.groupId, body),
});
