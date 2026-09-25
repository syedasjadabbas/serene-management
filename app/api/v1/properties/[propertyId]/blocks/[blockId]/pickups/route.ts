import { definePropertyRoute } from "@/lib/http/route";
import { blockParamsSchema, pickupSchema } from "@/modules/groups/groups.schema";
import { pickup } from "@/modules/groups/groups.service";

/** Books rooms from a definite block at the block's rate. Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "reservations:create",
  params: blockParamsSchema,
  body: pickupSchema,
  idempotent: true,
  rateLimit: { name: "groups.pickup.ip", limit: 120, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, params, body, idempotency }) => pickup(ctx, params.blockId, body, idempotency),
});
