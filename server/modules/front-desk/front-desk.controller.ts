import { handleProperty, withMeta } from "@/lib/controller";
import { listRoomBoard } from "@/modules/rooms/rooms.service";
import {
  checkIn,
  checkOut,
  extendStay,
  getStay,
  getSummary,
  listArrivals,
  listDepartures,
  listInHouse,
  listRoomOptions,
  moveRoom,
  reverseCheckIn,
  walkIn,
} from "./front-desk.service";

/** Due-in reservation rooms for the business date (pending and checked in today). */
export const arrivals = handleProperty(async (req, res) => {
  const { items, meta } = await listArrivals(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

/** Due out (departure on or before the business date) and departed on the business date. */
export const departures = handleProperty(async (req, res) => {
  const { items, meta } = await listDepartures(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

export const inHouse = handleProperty(async (req, res) => {
  const { items, meta } = await listInHouse(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

/** Room board rows for the front desk (the shared board of the rooms module, without counts). */
export const rooms = handleProperty(
  async (req, res) => (await listRoomBoard(req.ctx, res.locals.query)).items,
);

/** Counts for the front desk tabs and the room board, for the business date. */
export const summary = handleProperty((req) => getSummary(req.ctx));

/** Walk-in: book and check in, in one transaction. An Idempotency-Key makes a retry return the first stay. */
export const walkInStay = handleProperty(
  (req) => walkIn(req.ctx, req.body, req.idempotency ?? null),
  {
    status: 201,
  },
);

/** Due-in reservation room -> in house (creates the stay). */
export const checkInRoom = handleProperty(
  (req) => checkIn(req.ctx, req.params.reservationRoomId, req.body),
  { status: 201 },
);

/** Rooms of the booked type free for the remaining nights, with readiness. */
export const roomOptions = handleProperty((req) =>
  listRoomOptions(req.ctx, req.params.reservationRoomId),
);

export const stay = handleProperty((req) => getStay(req.ctx, req.params.stayId));
export const stayCheckOut = handleProperty((req) => checkOut(req.ctx, req.params.stayId, req.body));
export const stayExtend = handleProperty((req) => extendStay(req.ctx, req.params.stayId, req.body));
export const stayReverseCheckIn = handleProperty((req) =>
  reverseCheckIn(req.ctx, req.params.stayId, req.body),
);
export const stayRoomMove = handleProperty((req) => moveRoom(req.ctx, req.params.stayId, req.body));
