import { definePropertyRoute } from "@/lib/http/route";
import { initializeBusinessDateSchema } from "@/modules/business-date/business-date.schema";
import { initializeBusinessDate } from "@/modules/business-date/business-date.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Go-live: opens the first business date of the property (once). */
export const POST = definePropertyRoute({
  permission: "properties:manage",
  params: propertyParamsSchema,
  body: initializeBusinessDateSchema,
  status: 201,
  handler: ({ ctx, body }) => initializeBusinessDate(ctx, body),
});
