import { definePropertyRoute } from "@/lib/http/route";
import { roomMoveSchema, stayParamsSchema } from "@/modules/front-desk/front-desk.schema";
import { moveRoom } from "@/modules/front-desk/front-desk.service";

/** In-house room move (same room type) for the remaining nights. */
export const POST = definePropertyRoute({
  permission: "rooms:assign",
  params: stayParamsSchema,
  body: roomMoveSchema,
  handler: ({ ctx, params, body }) => moveRoom(ctx, params.stayId, body),
});
