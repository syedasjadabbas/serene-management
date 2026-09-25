import { defineSessionRoute, withMeta } from "@/lib/http/route";
import { guestHistoryQuerySchema, guestParamsSchema } from "@/modules/guests/guests.schema";
import { guestHistory } from "@/modules/guests/guests.service";

/** Reservations and stays of the guest at the properties the caller may read. */
export const GET = defineSessionRoute({
  params: guestParamsSchema,
  query: guestHistoryQuerySchema,
  handler: async ({ ctx, params, query }) => {
    const { items, nextCursor, properties } = await guestHistory(ctx, params.guestId, query);
    return withMeta(items, { nextCursor, limit: query.limit, properties });
  },
});
