import { definePropertyRoute } from "@/lib/http/route";
import { adjustSchema, itemParamsSchema } from "@/modules/billing/billing.schema";
import { adjustItem } from "@/modules/billing/billing.service";

/** Credits part or all of a charge, taxes proportionally (high-risk). Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "billing:adjust",
  params: itemParamsSchema,
  body: adjustSchema,
  idempotent: true,
  rateLimit: { name: "billing.write", limit: 120, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, params, body, idempotency }) =>
    adjustItem(ctx, params.itemId, body, idempotency),
});
