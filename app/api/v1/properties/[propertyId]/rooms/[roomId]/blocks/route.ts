import { definePropertyRoute } from "@/lib/http/route";
import { placeRoomBlock } from "@/modules/rooms/room-operations.service";
import { placeBlockSchema, roomParamsSchema } from "@/modules/rooms/rooms.schema";

/** Out of order (removed from inventory) or out of service; high-risk, reason required. */
export const POST = definePropertyRoute({
  permission: "rooms:out_of_order",
  params: roomParamsSchema,
  body: placeBlockSchema,
  status: 201,
  handler: ({ ctx, params, body }) => placeRoomBlock(ctx, params.roomId, body),
});
