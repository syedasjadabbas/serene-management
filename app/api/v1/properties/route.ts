import { defineSessionRoute } from "@/lib/http/route";
import { createPropertySchema } from "@/modules/properties/properties.schema";
import { createProperty, listAccessibleProperties } from "@/modules/properties/properties.service";

export const GET = defineSessionRoute({
  handler: ({ ctx }) => listAccessibleProperties(ctx),
});

export const POST = defineSessionRoute({
  permission: "properties:manage",
  body: createPropertySchema,
  status: 201,
  handler: ({ ctx, body }) => createProperty(ctx, body),
});
