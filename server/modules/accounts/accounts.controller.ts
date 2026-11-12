import { handle, withMeta } from "@/lib/controller";
import * as service from "./accounts.service";

/** Company and travel-agent profiles of the organization. */
export const list = handle(async (req, res) => {
  const { items, nextCursor } = await service.listAccounts(req.ctx, res.locals.query);
  return withMeta(items, { nextCursor, limit: res.locals.query.limit });
});

export const create = handle((req) => service.createAccount(req.ctx, req.body), { status: 201 });

export const get = handle((req) => service.getAccount(req.ctx, req.params.accountId));

export const update = handle((req) =>
  service.updateAccount(req.ctx, req.params.accountId, req.body),
);

export const setContact = handle((req) =>
  service.setAccountContact(req.ctx, req.params.accountId, req.params.guestId, req.body),
);

export const removeContact = handle((req) =>
  service.removeAccountContact(req.ctx, req.params.accountId, req.params.guestId),
);
