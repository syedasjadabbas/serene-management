import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { getProperty } from "@/modules/properties/properties.service";

export const GET = definePropertyRoute({
  params: propertyParamsSchema,
  handler: ({ ctx }) => getProperty(ctx),
});
