import { definePropertyRoute } from "@/lib/http/route";
import { chargeSchema, folioParamsSchema } from "@/modules/billing/billing.schema";
import { previewCharge } from "@/modules/billing/billing.service";

/** What a charge would post (taxes calculated by the server); posts nothing. */
export const POST = definePropertyRoute({
  permission: "billing:post",
  params: folioParamsSchema,
  body: chargeSchema,
  handler: ({ ctx, params, body }) => previewCharge(ctx, params.folioId, body),
});
