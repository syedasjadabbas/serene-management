import { definePropertyRoute } from "@/lib/http/route";
import {
  propertyParamsSchema,
  updatePropertyConfigurationSchema,
} from "@/modules/properties/properties.schema";
import {
  getPropertyConfiguration,
  updatePropertyConfiguration,
} from "@/modules/properties/properties.service";

export const GET = definePropertyRoute({
  permission: "settings:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => getPropertyConfiguration(ctx),
});

export const PATCH = definePropertyRoute({
  permission: "settings:manage",
  params: propertyParamsSchema,
  body: updatePropertyConfigurationSchema,
  handler: ({ ctx, body }) => updatePropertyConfiguration(ctx, body),
});
