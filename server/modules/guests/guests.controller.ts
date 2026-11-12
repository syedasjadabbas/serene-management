import { handle, withMeta } from "@/lib/controller";
import * as service from "./guests.service";

export const options = handle((req) => service.guestOptions(req.ctx));

export const list = handle(async (req, res) => {
  const { items, nextCursor } = await service.searchGuests(req.ctx, res.locals.query);
  return withMeta(items, { nextCursor, limit: res.locals.query.limit });
});

export const create = handle((req) => service.createGuest(req.ctx, req.body), { status: 201 });

export const get = handle((req) => service.getGuest(req.ctx, req.params.guestId));

export const update = handle((req) => service.updateGuest(req.ctx, req.params.guestId, req.body));

/** Reservations and stays of the guest at the properties the caller may read. */
export const history = handle(async (req, res) => {
  const { items, nextCursor, properties } = await service.guestHistory(
    req.ctx,
    req.params.guestId,
    res.locals.query,
  );
  return withMeta(items, { nextCursor, limit: res.locals.query.limit, properties });
});

export const addNote = handle(
  (req) => service.addGuestNote(req.ctx, req.params.guestId, req.body),
  { status: 201 },
);

export const deleteNote = handle((req) =>
  service.deleteGuestNote(req.ctx, req.params.guestId, req.params.noteId),
);

export const setPreferences = handle((req) =>
  service.setGuestPreferences(req.ctx, req.params.guestId, req.body),
);
