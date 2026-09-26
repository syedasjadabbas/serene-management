import { definePropertyRoute } from "@/lib/http/route";
import { reservationRoomParamsSchema, roomChargesSchema } from "@/modules/billing/billing.schema";
import { postRoomCharges } from "@/modules/billing/billing.service";

/** Posts room (and package) charges of past unposted nights. Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "billing:post",
  params: reservationRoomParamsSchema,
  body: roomChargesSchema,
  idempotent: true,
  rateLimit: { name: "billing.write", limit: 120, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, params, body, idempotency }) =>
    postRoomCharges(ctx, params.reservationRoomId, body, idempotency),
});
