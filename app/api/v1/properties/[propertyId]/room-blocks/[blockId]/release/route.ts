import { definePropertyRoute } from "@/lib/http/route";
import { returnRoomToService } from "@/modules/rooms/room-operations.service";
import { blockParamsSchema, releaseBlockSchema } from "@/modules/rooms/rooms.schema";

/** Return to service: the room comes back dirty with a priority cleaning task. */
export const POST = definePropertyRoute({
  permission: "rooms:out_of_order",
  params: blockParamsSchema,
  body: releaseBlockSchema,
  handler: ({ ctx, params, body }) => returnRoomToService(ctx, params.blockId, body),
});
