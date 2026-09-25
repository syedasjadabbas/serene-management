import { defineSessionRoute } from "@/lib/http/route";
import { createTierSchema, programParamsSchema } from "@/modules/loyalty/loyalty.schema";
import { createTier } from "@/modules/loyalty/loyalty.service";

export const POST = defineSessionRoute({
  params: programParamsSchema,
  body: createTierSchema,
  status: 201,
  handler: ({ ctx, params, body }) => createTier(ctx, params.programId, body),
});
