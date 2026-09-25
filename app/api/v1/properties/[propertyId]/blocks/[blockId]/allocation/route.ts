import { definePropertyRoute } from "@/lib/http/route";
import { allocationSchema, blockParamsSchema } from "@/modules/groups/groups.schema";
import { setAllocation } from "@/modules/groups/groups.service";

export const POST = definePropertyRoute({
  permission: "groups:manage",
  params: blockParamsSchema,
  body: allocationSchema,
  handler: ({ ctx, params, body }) => setAllocation(ctx, params.blockId, body),
});
