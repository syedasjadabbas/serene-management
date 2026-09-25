import { definePropertyRoute } from "@/lib/http/route";
import { blockParamsSchema, blockStatusSchema } from "@/modules/groups/groups.schema";
import { changeBlockStatus } from "@/modules/groups/groups.service";

export const POST = definePropertyRoute({
  permission: "groups:manage",
  params: blockParamsSchema,
  body: blockStatusSchema,
  handler: ({ ctx, params, body }) => changeBlockStatus(ctx, params.blockId, body),
});
