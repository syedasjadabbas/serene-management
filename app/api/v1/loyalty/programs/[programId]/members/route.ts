import { defineSessionRoute, withMeta } from "@/lib/http/route";
import { membersQuerySchema, programParamsSchema } from "@/modules/loyalty/loyalty.schema";
import { listMembers } from "@/modules/loyalty/loyalty.service";

export const GET = defineSessionRoute({
  params: programParamsSchema,
  query: membersQuerySchema,
  handler: async ({ ctx, params, query }) => {
    const { items, nextCursor } = await listMembers(ctx, params.programId, query);
    return withMeta(items, { nextCursor, limit: query.limit });
  },
});
