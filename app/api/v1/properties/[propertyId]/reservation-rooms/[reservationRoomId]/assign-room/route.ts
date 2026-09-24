import { definePropertyRoute } from "@/lib/http/route";
import {
  assignRoomSchema,
  reservationRoomParamsSchema,
} from "@/modules/reservations/reservations.schema";
import { assignRoom } from "@/modules/reservations/reservations.service";

/** Assign (or unassign with roomId null) a specific room for the whole stay. */
export const POST = definePropertyRoute({
  permission: "rooms:assign",
  params: reservationRoomParamsSchema,
  body: assignRoomSchema,
  handler: ({ ctx, params, body }) => assignRoom(ctx, params.reservationRoomId, body),
});
