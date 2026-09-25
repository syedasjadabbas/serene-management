import { defineSessionRoute } from "@/lib/http/route";
import { accountParamsSchema, updateAccountSchema } from "@/modules/accounts/accounts.schema";
import { getAccount, updateAccount } from "@/modules/accounts/accounts.service";

export const GET = defineSessionRoute({
  params: accountParamsSchema,
  handler: ({ ctx, params }) => getAccount(ctx, params.accountId),
});

export const PATCH = defineSessionRoute({
  params: accountParamsSchema,
  body: updateAccountSchema,
  handler: ({ ctx, params, body }) => updateAccount(ctx, params.accountId, body),
});
