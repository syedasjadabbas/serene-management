import { definePropertyRoute } from "@/lib/http/route";
import { setRatePlanPackages } from "@/modules/rates/rate-plans.service";
import { ratePlanPackagesSchema, ratePlanParamsSchema } from "@/modules/rates/rates.schema";

/** Replaces the packages included in a rate plan. */
export const PUT = definePropertyRoute({
  permission: "rates:manage",
  params: ratePlanParamsSchema,
  body: ratePlanPackagesSchema,
  handler: ({ ctx, params, body }) => setRatePlanPackages(ctx, params.ratePlanId, body),
});
