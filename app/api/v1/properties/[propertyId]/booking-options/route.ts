import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { getBookingOptions } from "@/modules/reservations/reservations.service";

/** Reference data for booking forms (room types, rate plans, reservation types, codes, reasons). */
export const GET = definePropertyRoute({
  permission: "reservations:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => getBookingOptions(ctx),
});
