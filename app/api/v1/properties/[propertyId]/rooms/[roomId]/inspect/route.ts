import { definePropertyRoute } from "@/lib/http/route";
import { inspectRoomSchema, roomParamsSchema } from "@/modules/housekeeping/housekeeping.schema";
import { inspectRoom } from "@/modules/housekeeping/housekeeping.service";

export const POST = definePropertyRoute({
  permission: "housekeeping:inspect",
  params: roomParamsSchema,
  body: inspectRoomSchema,
  handler: ({ ctx, params, body }) => inspectRoom(ctx, params.roomId, body),
});
