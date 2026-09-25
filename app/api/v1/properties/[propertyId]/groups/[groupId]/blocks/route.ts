import { definePropertyRoute } from "@/lib/http/route";
import { createBlockSchema, groupParamsSchema } from "@/modules/groups/groups.schema";
import { createBlock } from "@/modules/groups/groups.service";

/** New block with its allocation grid; a definite block must fit house availability. */
export const POST = definePropertyRoute({
  permission: "groups:manage",
  params: groupParamsSchema,
  body: createBlockSchema,
  status: 201,
  handler: ({ ctx, params, body }) => createBlock(ctx, params.groupId, body),
});
