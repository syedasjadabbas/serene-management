import { definePropertyRoute } from "@/lib/http/route";
import { getBusinessDateView } from "@/modules/business-date/business-date.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Every user with access to the property may read its business date. */
export const GET = definePropertyRoute({
  params: propertyParamsSchema,
  handler: ({ ctx }) => getBusinessDateView({ propertyId: ctx.propertyId, timezone: ctx.timezone }),
});
