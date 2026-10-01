import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { openPropertyEvents } from "@/modules/realtime/realtime.service";

/**
 * Live updates of one property (server-sent events, docs/SCALABILITY.md §31).
 * Any user with access to the property may subscribe; the service limits the
 * topics to what they may read there. Reconnects are rate limited per user.
 */
export const GET = definePropertyRoute({
  params: propertyParamsSchema,
  rateLimit: { name: "realtime.connect", limit: 30, windowMs: 60_000 },
  handler: async ({ request, ctx }) => openPropertyEvents(ctx, request),
});
