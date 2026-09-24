import { definePropertyRoute } from "@/lib/http/route";
import { folioParamsSchema, ledgerQuerySchema } from "@/modules/billing/billing.schema";
import { listLedger } from "@/modules/billing/billing.service";

/** A window's ledger, oldest first, with the running balance. */
export const GET = definePropertyRoute({
  permission: "billing:read",
  params: folioParamsSchema,
  query: ledgerQuerySchema,
  handler: ({ ctx, params, query }) => listLedger(ctx, params.folioId, query),
});
