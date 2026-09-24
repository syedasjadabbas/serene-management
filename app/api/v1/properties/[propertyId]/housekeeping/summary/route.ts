import { definePropertyRoute } from "@/lib/http/route";
import { getHousekeepingSummary } from "@/modules/housekeeping/housekeeping.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "housekeeping:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => getHousekeepingSummary(ctx),
});
