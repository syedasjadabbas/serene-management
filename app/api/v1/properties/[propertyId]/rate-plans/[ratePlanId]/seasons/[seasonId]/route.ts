import { definePropertyRoute } from "@/lib/http/route";
import { removeSeason, updateSeasonPrices } from "@/modules/rates/rate-plans.service";
import { deleteSeasonSchema, seasonParamsSchema, seasonSchema } from "@/modules/rates/rates.schema";

export const PATCH = definePropertyRoute({
  permission: "rates:manage",
  params: seasonParamsSchema,
  body: seasonSchema,
  handler: ({ ctx, params, body }) =>
    updateSeasonPrices(ctx, params.ratePlanId, params.seasonId, body),
});

export const DELETE = definePropertyRoute({
  permission: "rates:manage",
  params: seasonParamsSchema,
  body: deleteSeasonSchema,
  handler: ({ ctx, params, body }) => removeSeason(ctx, params.ratePlanId, params.seasonId, body),
});
