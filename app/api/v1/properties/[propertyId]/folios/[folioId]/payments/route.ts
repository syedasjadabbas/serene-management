import { definePropertyRoute } from "@/lib/http/route";
import { folioParamsSchema, paymentSchema } from "@/modules/billing/billing.schema";
import { postPayment } from "@/modules/billing/payments.service";

/** Takes a payment against one window, at most its balance. Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "payments:create",
  params: folioParamsSchema,
  body: paymentSchema,
  idempotent: true,
  rateLimit: { name: "billing.write.ip", limit: 120, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, params, body, idempotency }) =>
    postPayment(ctx, params.folioId, body, idempotency),
});
