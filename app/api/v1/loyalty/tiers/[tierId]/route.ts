import { defineSessionRoute } from "@/lib/http/route";
import { tierParamsSchema, updateTierSchema } from "@/modules/loyalty/loyalty.schema";
import { updateTier } from "@/modules/loyalty/loyalty.service";

export const PATCH = defineSessionRoute({
  params: tierParamsSchema,
  body: updateTierSchema,
  handler: ({ ctx, params, body }) => updateTier(ctx, params.tierId, body),
});
