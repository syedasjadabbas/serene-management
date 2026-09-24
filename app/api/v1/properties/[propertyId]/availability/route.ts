import { definePropertyRoute } from "@/lib/http/route";
import { availabilityQuerySchema } from "@/modules/availability/availability.schema";
import { searchAvailability } from "@/modules/availability/availability.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Room types that can accommodate the request, with counts, status and rate quotes. */
export const GET = definePropertyRoute({
  permission: "availability:read",
  params: propertyParamsSchema,
  query: availabilityQuerySchema,
  handler: ({ ctx, query }) => searchAvailability(ctx, query),
});
