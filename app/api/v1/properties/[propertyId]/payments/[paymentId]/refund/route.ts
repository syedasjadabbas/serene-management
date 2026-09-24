import { definePropertyRoute } from "@/lib/http/route";
import { paymentParamsSchema, refundSchema } from "@/modules/billing/billing.schema";
import { refundPayment } from "@/modules/billing/payments.service";

/** Refunds part or all of a captured payment (high-risk, reason required). Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "payments:refund",
  params: paymentParamsSchema,
  body: refundSchema,
  idempotent: true,
  rateLimit: { name: "billing.write.ip", limit: 120, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, params, body, idempotency }) =>
    refundPayment(ctx, params.paymentId, body, idempotency),
});
