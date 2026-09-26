import { definePropertyRoute } from "@/lib/http/route";
import { itemParamsSchema, reverseSchema } from "@/modules/billing/billing.schema";
import { reverseItem } from "@/modules/billing/billing.service";

/** Same-day reversal of a charge and its taxes (high-risk, reason required). Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "billing:adjust",
  params: itemParamsSchema,
  body: reverseSchema,
  idempotent: true,
  rateLimit: { name: "billing.write", limit: 120, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, params, body, idempotency }) =>
    reverseItem(ctx, params.itemId, body, idempotency),
});
