import { definePropertyRoute } from "@/lib/http/route";
import { groupParamsSchema, groupStatusSchema } from "@/modules/groups/groups.schema";
import { changeGroupStatus } from "@/modules/groups/groups.service";

/** Closes or cancels a group (cancelling needs zero pickup; blocks return their rooms). */
export const POST = definePropertyRoute({
  permission: "groups:manage",
  params: groupParamsSchema,
  body: groupStatusSchema,
  handler: ({ ctx, params, body }) => changeGroupStatus(ctx, params.groupId, body),
});
