import { definePropertyRoute } from "@/lib/http/route";
import { blockParamsSchema, releaseSchema } from "@/modules/groups/groups.schema";
import { releaseBlock } from "@/modules/groups/groups.service";

/** Returns unpicked rooms to house inventory (irreversible). Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "groups:manage",
  params: blockParamsSchema,
  body: releaseSchema,
  idempotent: true,
  status: 201,
  handler: ({ ctx, params, body, idempotency }) =>
    releaseBlock(ctx, params.blockId, body, idempotency),
});
