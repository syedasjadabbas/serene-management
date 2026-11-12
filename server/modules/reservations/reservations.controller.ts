import { handleProperty, withMeta } from "@/lib/controller";
import * as service from "./reservations.service";

/** Reference data for booking forms (room types, rate plans, reservation types, codes, reasons). */
export const bookingOptions = handleProperty((req) => service.getBookingOptions(req.ctx));

/** Physical rooms of a type that are free (not assigned, not out of order) for a stay. */
export const availableRooms = handleProperty((req, res) =>
  service.listAvailableRooms(req.ctx, res.locals.query),
);

export const list = handleProperty(async (req, res) => {
  const { items, meta } = await service.listReservations(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

/** An Idempotency-Key, when sent, makes a retried booking return the first one. */
export const create = handleProperty(
  (req) => service.createReservation(req.ctx, req.body, req.idempotency),
  { status: 201 },
);

export const get = handleProperty((req) =>
  service.getReservation(req.ctx, req.params.reservationId),
);

/** Sets or clears the company (and booking contact) of a reservation. */
export const setCompany = handleProperty((req) =>
  service.setReservationCompany(req.ctx, req.params.reservationId, req.body),
);

/** Modify dates, party, room type, rate plan, guest, codes or ETA of one reservation room. */
export const updateRoom = handleProperty((req) =>
  service.updateReservationRoom(req.ctx, req.params.reservationRoomId, req.body),
);

/** Assign (or unassign with roomId null) a specific room for the whole stay. */
export const assignRoom = handleProperty((req) =>
  service.assignRoom(req.ctx, req.params.reservationRoomId, req.body),
);

/** High-risk: reason code and written reason required; releases inventory and room. */
export const cancel = handleProperty((req) =>
  service.cancelReservation(req.ctx, req.params.reservationRoomId, req.body),
);

/** Tentative or waitlisted to confirmed (inventory-deducting reservation type). */
export const confirm = handleProperty((req) =>
  service.confirmReservation(req.ctx, req.params.reservationRoomId, req.body),
);

/** High-risk: only on or after the arrival business date; releases inventory and room. */
export const noShow = handleProperty((req) =>
  service.markNoShow(req.ctx, req.params.reservationRoomId, req.body),
);

/** Books a separately sold package on future nights of the stay. */
export const addPackage = handleProperty(
  (req) => service.addReservationPackage(req.ctx, req.params.reservationRoomId, req.body),
  { status: 201 },
);

export const removePackage = handleProperty((req) =>
  service.removeReservationPackage(
    req.ctx,
    req.params.reservationRoomId,
    req.params.reservationPackageId,
  ),
);

/** High-risk: cancelled to reserved when availability allows (or override). */
export const reinstate = handleProperty((req) =>
  service.reinstateReservation(req.ctx, req.params.reservationRoomId, req.body),
);

/** High-risk: no-show to reserved from the business date while nights remain. */
export const reinstateNoShow = handleProperty((req) =>
  service.reinstateNoShow(req.ctx, req.params.reservationRoomId, req.body),
);
