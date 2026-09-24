import { definePropertyRoute } from "@/lib/http/route";
import { roomParamsSchema } from "@/modules/rooms/rooms.schema";
import { getRoom } from "@/modules/rooms/rooms.service";

export const GET = definePropertyRoute({
  permission: "rooms:read",
  params: roomParamsSchema,
  handler: ({ ctx, params }) => getRoom(ctx, params.roomId),
});
