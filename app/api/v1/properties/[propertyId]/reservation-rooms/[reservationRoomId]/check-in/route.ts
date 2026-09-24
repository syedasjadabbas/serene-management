import { definePropertyRoute } from "@/lib/http/route";
import { checkInSchema } from "@/modules/front-desk/front-desk.schema";
import { checkIn } from "@/modules/front-desk/front-desk.service";
import { reservationRoomParamsSchema } from "@/modules/reservations/reservations.schema";

/** Due-in reservation room → in house (creates the stay). */
export const POST = definePropertyRoute({
  permission: "frontdesk:checkin",
  params: reservationRoomParamsSchema,
  body: checkInSchema,
  status: 201,
  handler: ({ ctx, params, body }) => checkIn(ctx, params.reservationRoomId, body),
});
