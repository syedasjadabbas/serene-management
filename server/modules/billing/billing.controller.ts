import { handleProperty, withMeta } from "@/lib/controller";
import * as billing from "./billing.service";
import * as payments from "./payments.service";

/** Charge codes, payment methods and financial reason codes (database configuration). */
export const options = handleProperty((req) => billing.billingOptions(req.ctx));

/** Guest accounts: in-house stays, accounts with a balance, or every folio. */
export const listFolios = handleProperty(async (req, res) => {
  const query = res.locals.query;
  const { items, nextCursor } = await billing.listFolios(req.ctx, query);
  return withMeta(items, { nextCursor, limit: query.limit });
});

/** A window's ledger, oldest first, with the running balance. */
export const listLedger = handleProperty((req, res) =>
  billing.listLedger(req.ctx, req.params.folioId, res.locals.query),
);

/** Manual charge: the server derives taxes, total, currency and business date. */
export const postCharge = handleProperty(
  (req) => billing.postCharge(req.ctx, req.params.folioId, req.body, req.idempotency),
  { status: 201 },
);

/** What a charge would post (taxes calculated by the server); posts nothing. */
export const previewCharge = handleProperty((req) =>
  billing.previewCharge(req.ctx, req.params.folioId, req.body),
);

/** Takes a payment against one window, at most its balance. */
export const postPayment = handleProperty(
  (req) => payments.postPayment(req.ctx, req.params.folioId, req.body, req.idempotency),
  { status: 201 },
);

/** Confirms a zero-balance window as settled. */
export const settleFolio = handleProperty((req) =>
  billing.settleFolio(req.ctx, req.params.folioId, req.body),
);

/** Credits part or all of a charge, taxes proportionally. */
export const adjustItem = handleProperty(
  (req) => billing.adjustItem(req.ctx, req.params.itemId, req.body, req.idempotency),
  { status: 201 },
);

/** Same-day reversal of a charge and its taxes. */
export const reverseItem = handleProperty(
  (req) => billing.reverseItem(req.ctx, req.params.itemId, req.body, req.idempotency),
  { status: 201 },
);

/** Voids a payment taken today. */
export const voidPayment = handleProperty(
  (req) => payments.voidPayment(req.ctx, req.params.paymentId, req.body, req.idempotency),
  { status: 201 },
);

/** Refunds part or all of a captured payment. */
export const refundPayment = handleProperty(
  (req) => payments.refundPayment(req.ctx, req.params.paymentId, req.body, req.idempotency),
  { status: 201 },
);

/** Expected room, package and tax charges per night; nothing is posted. */
export const chargeEstimate = handleProperty((req) =>
  billing.estimateStayCharges(req.ctx, req.params.reservationRoomId),
);

/** The stay account: windows with ledger-maintained balances, room-night posting state. */
export const getFolioAccount = handleProperty((req) =>
  billing.getFolioAccount(req.ctx, req.params.reservationRoomId),
);

/** Opens the next billing window. */
export const openWindow = handleProperty(
  (req) => billing.openWindow(req.ctx, req.params.reservationRoomId),
  { status: 201 },
);

/** Financial audit trail of the stay windows (also requires audit:read). */
export const folioHistory = handleProperty((req) =>
  billing.folioHistory(req.ctx, req.params.reservationRoomId),
);

/** Posts room (and package) charges of past unposted nights. */
export const postRoomCharges = handleProperty(
  (req) =>
    billing.postRoomCharges(req.ctx, req.params.reservationRoomId, req.body, req.idempotency),
  { status: 201 },
);
