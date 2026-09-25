import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { createRatePlan, listRatePlans } from "@/modules/rates/rate-plans.service";
import { createRatePlanSchema } from "@/modules/rates/rates.schema";

export const GET = definePropertyRoute({
  permission: "rates:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => listRatePlans(ctx),
});

/** New rate plan in the property currency (high-risk: reason required). */
export const POST = definePropertyRoute({
  permission: "rates:manage",
  params: propertyParamsSchema,
  body: createRatePlanSchema,
  status: 201,
  handler: ({ ctx, body }) => createRatePlan(ctx, body),
});
