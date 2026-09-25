import { definePropertyRoute } from "@/lib/http/route";
import { createSeason } from "@/modules/rates/rate-plans.service";
import { ratePlanParamsSchema, seasonSchema } from "@/modules/rates/rates.schema";

/** Adds a pricing season to a base plan (ambiguous overlaps are refused). */
export const POST = definePropertyRoute({
  permission: "rates:manage",
  params: ratePlanParamsSchema,
  body: seasonSchema,
  status: 201,
  handler: ({ ctx, params, body }) => createSeason(ctx, params.ratePlanId, body),
});
