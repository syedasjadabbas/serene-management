import { definePropertyRoute } from "@/lib/http/route";
import {
  roomHousekeepingSchema,
  roomParamsSchema,
} from "@/modules/housekeeping/housekeeping.schema";
import { setRoomHousekeeping } from "@/modules/housekeeping/housekeeping.service";

export const POST = definePropertyRoute({
  permission: "housekeeping:assign",
  params: roomParamsSchema,
  body: roomHousekeepingSchema,
  handler: ({ ctx, params, body }) => setRoomHousekeeping(ctx, params.roomId, "mark_clean", body),
});
