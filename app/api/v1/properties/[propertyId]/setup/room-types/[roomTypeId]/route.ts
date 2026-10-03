import { definePropertyRoute } from "@/lib/http/route";
import { roomTypeParamsSchema, updateRoomTypeSchema } from "@/modules/setup/setup.schema";
import { updateRoomType } from "@/modules/setup/setup.service";

/** Edits (or retires) one entry of the property setup (settings:manage, HIGH audit). */
export const PATCH = definePropertyRoute({
  permission: "settings:manage",
  params: roomTypeParamsSchema,
  body: updateRoomTypeSchema,
  handler: ({ ctx, params, body }) => updateRoomType(ctx, params.roomTypeId, body),
});
