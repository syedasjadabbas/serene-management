import { definePropertyRoute } from "@/lib/http/route";
import { listRoomOptions } from "@/modules/front-desk/front-desk.service";
import { reservationRoomParamsSchema } from "@/modules/reservations/reservations.schema";

/** Rooms of the booked type free for the remaining nights, with readiness (check-in / move). */
export const GET = definePropertyRoute({
  permission: "rooms:read",
  params: reservationRoomParamsSchema,
  handler: ({ ctx, params }) => listRoomOptions(ctx, params.reservationRoomId),
});
