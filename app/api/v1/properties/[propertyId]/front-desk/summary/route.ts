import { definePropertyRoute } from "@/lib/http/route";
import { getSummary } from "@/modules/front-desk/front-desk.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

/** Counts for the front desk tabs and the room board, for the business date. */
export const GET = definePropertyRoute({
  permission: "frontdesk:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => getSummary(ctx),
});
