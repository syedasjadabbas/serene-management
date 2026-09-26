import { definePropertyRoute } from "@/lib/http/route";
import { copySetupParamsSchema, copySetupSchema } from "@/modules/properties/properties.schema";
import { copyPropertySetup } from "@/modules/properties/property-setup.service";

/** Copies another property's reference setup into this one, before go-live (D37). */
export const POST = definePropertyRoute({
  params: copySetupParamsSchema,
  permission: "properties:manage",
  body: copySetupSchema,
  handler: ({ ctx, params, body }) => copyPropertySetup(ctx, ctx.propertyId, params.sourceId, body),
});
