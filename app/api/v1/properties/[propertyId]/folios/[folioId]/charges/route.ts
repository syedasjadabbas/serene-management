import { definePropertyRoute } from "@/lib/http/route";
import { chargeSchema, folioParamsSchema } from "@/modules/billing/billing.schema";
import { postCharge } from "@/modules/billing/billing.service";

/** Manual charge: the server derives taxes, total, currency and business date. Idempotency-Key required. */
export const POST = definePropertyRoute({
  permission: "billing:post",
  params: folioParamsSchema,
  body: chargeSchema,
  idempotent: true,
  rateLimit: { name: "billing.write", limit: 120, windowMs: 60_000 },
  status: 201,
  handler: ({ ctx, params, body, idempotency }) =>
    postCharge(ctx, params.folioId, body, idempotency),
});
