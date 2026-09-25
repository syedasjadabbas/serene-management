import { defineSessionRoute, withMeta } from "@/lib/http/route";
import { accountsQuerySchema, createAccountSchema } from "@/modules/accounts/accounts.schema";
import { createAccount, listAccounts } from "@/modules/accounts/accounts.service";

/** Company and travel-agent profiles of the organization. */
export const GET = defineSessionRoute({
  query: accountsQuerySchema,
  handler: async ({ ctx, query }) => {
    const { items, nextCursor } = await listAccounts(ctx, query);
    return withMeta(items, { nextCursor, limit: query.limit });
  },
});

export const POST = defineSessionRoute({
  body: createAccountSchema,
  status: 201,
  handler: ({ ctx, body }) => createAccount(ctx, body),
});
