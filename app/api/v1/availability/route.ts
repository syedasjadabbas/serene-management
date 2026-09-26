import { defineSessionRoute } from "@/lib/http/route";
import { centralAvailabilityQuerySchema } from "@/modules/organization/organization.schema";
import { centralAvailability } from "@/modules/organization/organization.service";

/** Central availability: search across accessible properties, booking handed off (D8). */
export const GET = defineSessionRoute({
  query: centralAvailabilityQuerySchema,
  rateLimit: { name: "availability.central", limit: 60, windowMs: 60_000 },
  handler: ({ ctx, query }) => centralAvailability(ctx, query),
});
