import { defineSessionRoute } from "@/lib/http/route";
import { createGuestSchema, guestSearchQuerySchema } from "@/modules/guests/guests.schema";
import { createGuest, searchGuests } from "@/modules/guests/guests.service";

/** Organization-wide guest search (bounded, server-side). */
export const GET = defineSessionRoute({
  query: guestSearchQuerySchema,
  handler: ({ ctx, query }) => searchGuests(ctx, query),
});

export const POST = defineSessionRoute({
  body: createGuestSchema,
  status: 201,
  handler: ({ ctx, body }) => createGuest(ctx, body),
});
