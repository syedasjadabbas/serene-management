import { definePropertyRoute } from "@/lib/http/route";
import { getRatePlan, updateRatePlan } from "@/modules/rates/rate-plans.service";
import { ratePlanParamsSchema, updateRatePlanSchema } from "@/modules/rates/rates.schema";

export const GET = definePropertyRoute({
  permission: "rates:read",
  params: ratePlanParamsSchema,
  handler: ({ ctx, params }) => getRatePlan(ctx, params.ratePlanId),
});

/** Versioned update (409 on a stale version); high-risk. */
export const PATCH = definePropertyRoute({
  permission: "rates:manage",
  params: ratePlanParamsSchema,
  body: updateRatePlanSchema,
  handler: ({ ctx, params, body }) => updateRatePlan(ctx, params.ratePlanId, body),
});
