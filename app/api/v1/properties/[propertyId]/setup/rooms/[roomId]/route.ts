import { definePropertyRoute } from "@/lib/http/route";
import { roomParamsSchema, updateRoomSchema } from "@/modules/setup/setup.schema";
import { updateRoom } from "@/modules/setup/setup.service";

/** Edits (or retires) one entry of the property setup (settings:manage, HIGH audit). */
export const PATCH = definePropertyRoute({
  permission: "settings:manage",
  params: roomParamsSchema,
  body: updateRoomSchema,
  handler: ({ ctx, params, body }) => updateRoom(ctx, params.roomId, body),
});
