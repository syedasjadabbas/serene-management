import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { rateCalendar } from "@/modules/rates/rate-plans.service";
import { calendarQuerySchema } from "@/modules/rates/rates.schema";

/** Day-by-day prices and restrictions of a plan and room type (the booking engine's own pricing). */
export const GET = definePropertyRoute({
  permission: "rates:read",
  params: propertyParamsSchema,
  query: calendarQuerySchema,
  handler: ({ ctx, query }) => rateCalendar(ctx, query),
});
