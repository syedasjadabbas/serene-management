import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { availableRoomsQuerySchema } from "@/modules/reservations/reservations.schema";
import { listAvailableRooms } from "@/modules/reservations/reservations.service";

/** Physical rooms of a type that are free (not assigned, not out of order) for a stay. */
export const GET = definePropertyRoute({
  permission: "rooms:read",
  params: propertyParamsSchema,
  query: availableRoomsQuerySchema,
  handler: ({ ctx, query }) => listAvailableRooms(ctx, query),
});
