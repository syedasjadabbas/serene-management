import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { rateAdminOptions } from "@/modules/rates/rate-plans.service";

export const GET = definePropertyRoute({
  permission: "rates:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => rateAdminOptions(ctx),
});
