import { definePropertyRoute } from "@/lib/http/route";
import { folioParamsSchema, settleSchema } from "@/modules/billing/billing.schema";
import { settleFolio } from "@/modules/billing/billing.service";

/** Confirms a zero-balance window as settled. */
export const POST = definePropertyRoute({
  permission: "payments:create",
  params: folioParamsSchema,
  body: settleSchema,
  handler: ({ ctx, params, body }) => settleFolio(ctx, params.folioId, body),
});
