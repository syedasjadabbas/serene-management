import { defineSessionRoute } from "@/lib/http/route";
import { membershipParamsSchema, pointsAdjustmentSchema } from "@/modules/loyalty/loyalty.schema";
import { adjustPoints } from "@/modules/loyalty/loyalty.service";

/**
 * Manual points correction. Carries the membership version: a retried
 * request answers 409 instead of adjusting twice.
 */
export const POST = defineSessionRoute({
  params: membershipParamsSchema,
  body: pointsAdjustmentSchema,
  status: 201,
  handler: ({ ctx, params, body }) => adjustPoints(ctx, params.membershipId, body),
});
