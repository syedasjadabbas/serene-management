import { definePropertyRoute } from "@/lib/http/route";
import { paymentParamsSchema, voidPaymentSchema } from "@/modules/billing/billing.schema";
import { voidPayment } from "@/modules/billing/payments.service";

/** Voids a payment taken today (high-risk, reason required). Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "payments:void",
  params: paymentParamsSchema,
  body: voidPaymentSchema,
  idempotent: true,
  rateLimit: { name: "billing.write", limit: 120, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, params, body, idempotency }) =>
    voidPayment(ctx, params.paymentId, body, idempotency),
});
