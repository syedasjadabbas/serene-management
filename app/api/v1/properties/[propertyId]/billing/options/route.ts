import { definePropertyRoute } from "@/lib/http/route";
import { billingOptions } from "@/modules/billing/billing.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Charge codes, payment methods and financial reason codes (database configuration). */
export const GET = definePropertyRoute({
  permission: "billing:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => billingOptions(ctx),
});
