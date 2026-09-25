import { defineSessionRoute } from "@/lib/http/route";
import {
  accountContactParamsSchema,
  accountContactSchema,
} from "@/modules/accounts/accounts.schema";
import { removeAccountContact, setAccountContact } from "@/modules/accounts/accounts.service";

/** Creates or updates the guest's relationship with the company (one per pair). */
export const PUT = defineSessionRoute({
  params: accountContactParamsSchema,
  body: accountContactSchema,
  handler: ({ ctx, params, body }) =>
    setAccountContact(ctx, params.accountId, params.guestId, body),
});

export const DELETE = defineSessionRoute({
  params: accountContactParamsSchema,
  handler: ({ ctx, params }) => removeAccountContact(ctx, params.accountId, params.guestId),
});
