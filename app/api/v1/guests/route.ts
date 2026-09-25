import { defineSessionRoute, withMeta } from "@/lib/http/route";
import { createGuestSchema, guestSearchQuerySchema } from "@/modules/guests/guests.schema";
import { createGuest, searchGuests } from "@/modules/guests/guests.service";

/** Organization-wide guest search / list (server-side, keyset pages). */
export const GET = defineSessionRoute({
  query: guestSearchQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, nextCursor } = await searchGuests(ctx, query);
    return withMeta(items, { nextCursor, limit: query.limit });
  },
});

export const POST = defineSessionRoute({
  body: createGuestSchema,
  status: 201,
  handler: ({ ctx, body }) => createGuest(ctx, body),
});
