import { definePropertyRoute } from "@/lib/http/route";
import { setRatePlanAccounts } from "@/modules/rates/rate-plans.service";
import { ratePlanAccountsSchema, ratePlanParamsSchema } from "@/modules/rates/rates.schema";

/** Replaces the companies a negotiated rate plan is sold to. */
export const PUT = definePropertyRoute({
  permission: "rates:manage",
  params: ratePlanParamsSchema,
  body: ratePlanAccountsSchema,
  handler: ({ ctx, params, body }) => setRatePlanAccounts(ctx, params.ratePlanId, body),
});
