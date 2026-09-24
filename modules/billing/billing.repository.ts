import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Billing data access: folios, folio_items (append-only ledger), transaction
 * codes, tax rules, payment methods, payments and refunds. Every query is
 * scoped by property. Folio totals are never written here — the ledger
 * trigger maintains them (migration 20260926090000).
 *
 * The folio header and list read reservation / guest / room rows as
 * read models; writes to those tables go through their modules' services.
 */

// --- Folios ---------------------------------------------------------------------------

export interface LockedFolio {
  id: string;
  reservation_room_id: string | null;
  window: number;
  status: "OPEN" | "SETTLED" | "CLOSED";
  currency_code: string;
  balance: string;
  version: number;
}

/** Locks folios FOR UPDATE in id order (ARCHITECTURE §5, lock 9). */
export async function lockFolios(tx: Tx, propertyId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return tx.$queryRaw<LockedFolio[]>`
    SELECT "id", "reservation_room_id", "window", "status"::text AS "status", "currency_code",
           "balance"::text AS "balance", "version"
    FROM "folios"
    WHERE "property_id" = ${propertyId}::uuid AND "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "id"
    FOR UPDATE`;
}

/** Locks every window of a reservation room FOR UPDATE, in id order. */
export function lockReservationRoomFolios(tx: Tx, propertyId: string, reservationRoomId: string) {
  return tx.$queryRaw<LockedFolio[]>`
    SELECT "id", "reservation_room_id", "window", "status"::text AS "status", "currency_code",
           "balance"::text AS "balance", "version"
    FROM "folios"
    WHERE "property_id" = ${propertyId}::uuid AND "reservation_room_id" = ${reservationRoomId}::uuid
    ORDER BY "id"
    FOR UPDATE`;
}

/** The balance recomputed from the ledger (the authority the stored balance must match). */
export async function ledgerBalance(tx: Tx, folioId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ total: string }[]>`
    SELECT COALESCE(SUM("amount"), 0)::text AS "total" FROM "folio_items" WHERE "folio_id" = ${folioId}::uuid`;
  return rows[0]!.total;
}

export function findFolioRef(tx: Tx, propertyId: string, id: string) {
  return tx.folio.findFirst({
    where: { id, propertyId },
    select: { id: true, reservationRoomId: true, window: true },
  });
}

export function findWindows(tx: Tx, propertyId: string, reservationRoomId: string) {
  return tx.folio.findMany({
    where: { propertyId, reservationRoomId },
    orderBy: { window: "asc" },
    select: {
      id: true,
      window: true,
      status: true,
      currencyCode: true,
      chargesTotal: true,
      creditsTotal: true,
      balance: true,
      version: true,
      openedAt: true,
      settledAt: true,
      closedAt: true,
      payeeGuest: { select: { firstName: true, lastName: true } },
      payeeAccount: { select: { name: true } },
    },
  });
}

export function findWindowRef(
  tx: Tx,
  propertyId: string,
  reservationRoomId: string,
  window: number,
) {
  return tx.folio.findFirst({
    where: { propertyId, reservationRoomId, window },
    select: { id: true },
  });
}

export function countWindows(tx: Tx, propertyId: string, reservationRoomId: string) {
  return tx.folio.count({ where: { propertyId, reservationRoomId } });
}

export function insertFolio(tx: Tx, data: Prisma.FolioUncheckedCreateInput) {
  return tx.folio.create({ data, select: { id: true, window: true } });
}

export function updateFolioVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.FolioUncheckedUpdateManyInput,
) {
  return tx.folio.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

/** Folio header: the reservation room, its guest, room and stay (read model). */
export function findAccountHeader(tx: Tx, propertyId: string, reservationRoomId: string) {
  return tx.reservationRoom.findFirst({
    where: { id: reservationRoomId, propertyId },
    select: {
      id: true,
      status: true,
      arrivalDate: true,
      departureDate: true,
      adults: true,
      children: true,
      lineNumber: true,
      primaryGuestId: true,
      reservation: { select: { confirmationNumber: true } },
      primaryGuest: { select: { id: true, firstName: true, lastName: true } },
      room: { select: { id: true, number: true } },
      roomType: { select: { code: true, name: true } },
      ratePlan: { select: { code: true } },
      stay: { select: { id: true, status: true } },
    },
  });
}

// --- Codes, taxes, methods, reasons ------------------------------------------------------

const codeSelect = {
  id: true,
  code: true,
  name: true,
  bucket: true,
  status: true,
  isManualPostAllowed: true,
  isPaidOut: true,
  isTaxInclusive: true,
  defaultPrice: true,
  minAmount: true,
  maxAmount: true,
  adjustmentCodeId: true,
  group: { select: { code: true, type: true } },
} as const satisfies Prisma.TransactionCodeSelect;

export function findTransactionCode(tx: Tx, propertyId: string, id: string) {
  return tx.transactionCode.findFirst({ where: { id, propertyId }, select: codeSelect });
}

export function findTransactionCodes(tx: Tx, propertyId: string, ids: string[]) {
  return tx.transactionCode.findMany({
    where: { propertyId, id: { in: ids } },
    select: codeSelect,
  });
}

/** Tax rules attached to the given codes and in force on `date`. */
export function findTaxRules(tx: Tx, propertyId: string, codeIds: string[], date: Date) {
  return tx.transactionCodeTax.findMany({
    where: {
      propertyId,
      transactionCodeId: { in: codeIds },
      taxRule: {
        status: "ACTIVE",
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
    },
    select: {
      transactionCodeId: true,
      sequence: true,
      taxRule: {
        select: {
          id: true,
          code: true,
          name: true,
          calculation: true,
          basis: true,
          rate: true,
          transactionCodeId: true,
        },
      },
    },
  });
}

export function findManualChargeCodes(tx: Tx, propertyId: string) {
  return tx.transactionCode.findMany({
    where: {
      propertyId,
      status: "ACTIVE",
      isManualPostAllowed: true,
      isPaidOut: false,
      bucket: { notIn: ["TAX", "PAYMENT", "NON_REVENUE"] },
      group: { type: "REVENUE" },
    },
    orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
    select: codeSelect,
  });
}

const methodSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  status: true,
  requiresReference: true,
  transactionCodeId: true,
  transactionCode: { select: { status: true, group: { select: { type: true } } } },
} as const satisfies Prisma.PaymentMethodSelect;

export function findPaymentMethod(tx: Tx, propertyId: string, id: string) {
  return tx.paymentMethod.findFirst({ where: { id, propertyId }, select: methodSelect });
}

export function findPaymentMethods(tx: Tx, propertyId: string) {
  return tx.paymentMethod.findMany({
    where: { propertyId, status: "ACTIVE" },
    orderBy: { code: "asc" },
    select: methodSelect,
  });
}

export type FinancialReasonCategory = "ADJUSTMENT" | "VOID" | "REFUND";

export function findReasonCode(
  tx: Tx,
  propertyId: string,
  id: string,
  category: FinancialReasonCategory,
) {
  return tx.reasonCode.findFirst({
    where: { id, propertyId, category, status: "ACTIVE" },
    select: { id: true, code: true, name: true, requiresComment: true },
  });
}

export function findFinancialReasonCodes(tx: Tx, propertyId: string) {
  return tx.reasonCode.findMany({
    where: { propertyId, status: "ACTIVE", category: { in: ["ADJUSTMENT", "VOID", "REFUND"] } },
    orderBy: [{ category: "asc" }, { code: "asc" }],
    select: { id: true, category: true, code: true, name: true },
  });
}

// --- Ledger -----------------------------------------------------------------------------

export function insertItem(tx: Tx, data: Prisma.FolioItemUncheckedCreateInput) {
  return tx.folioItem.create({ data, select: { id: true } });
}

const correctionSelect = { kind: true, amount: true } as const;

/** A posted line with what is needed to reverse or adjust it (and its generated taxes). */
export function findItemForCorrection(tx: Tx, propertyId: string, id: string) {
  return tx.folioItem.findFirst({
    where: { id, propertyId },
    select: {
      id: true,
      folioId: true,
      kind: true,
      source: true,
      transactionCodeId: true,
      businessDate: true,
      revenueDate: true,
      quantity: true,
      unitAmount: true,
      amount: true,
      currencyCode: true,
      description: true,
      reference: true,
      postingKey: true,
      roomId: true,
      originReservationRoomId: true,
      packageComponentId: true,
      paymentId: true,
      refundId: true,
      transactionCode: { select: { code: true, name: true, adjustmentCodeId: true } },
      corrections: { select: correctionSelect },
      generatedItems: {
        where: { kind: "TAX" },
        orderBy: { id: "asc" },
        select: {
          id: true,
          transactionCodeId: true,
          amount: true,
          description: true,
          corrections: { select: correctionSelect },
        },
      },
    },
  });
}

/** The ledger line that recorded a payment (not its refunds). */
export function findPaymentLine(tx: Tx, paymentId: string) {
  return tx.folioItem.findFirst({
    where: { paymentId, kind: "PAYMENT", refundId: null },
    select: { id: true, folioId: true, amount: true, transactionCodeId: true, description: true },
  });
}

/** Posting keys already used for a reservation room's room / package nights, with reversal state. */
export function findPostingKeys(tx: Tx, propertyId: string, reservationRoomId: string) {
  return tx.$queryRaw<{ posting_key: string; reversed: boolean }[]>`
    SELECT i."posting_key",
           EXISTS (SELECT 1 FROM "folio_items" r
                   WHERE r."corrects_item_id" = i."id" AND r."kind" = 'REVERSAL') AS "reversed"
    FROM "folio_items" i
    WHERE i."property_id" = ${propertyId}::uuid
      AND i."origin_reservation_room_id" = ${reservationRoomId}::uuid
      AND i."posting_key" IS NOT NULL`;
}

export interface LedgerRow {
  id: string;
  folio_id: string;
  kind: string;
  source: string;
  business_date: Date;
  revenue_date: Date | null;
  posted_at: Date;
  description: string;
  reference: string | null;
  comment: string | null;
  quantity: string;
  unit_amount: string;
  amount: string;
  running_balance: string;
  parent_item_id: string | null;
  corrects_item_id: string | null;
  payment_id: string | null;
  refund_id: string | null;
  code_id: string;
  code: string;
  code_name: string;
  reason_code: string | null;
  posted_by: string | null;
  reversed: boolean;
  adjusted: string;
  receipt_number: string | null;
  payment_status: string | null;
  payment_business_date: Date | null;
  refundable: string | null;
  refunded: string | null;
  method_name: string | null;
}

/**
 * One page of a window's ledger in posting order, with the running balance
 * computed by the database over the whole window (keyset pagination).
 */
export function findLedgerPage(
  tx: Tx,
  propertyId: string,
  folioId: string,
  after: { postedAt: Date; id: string } | null,
  limit: number,
) {
  const cursor = after
    ? Prisma.sql`WHERE (l."posted_at", l."id") > (${after.postedAt}, ${after.id}::uuid)`
    : Prisma.empty;
  return tx.$queryRaw<LedgerRow[]>`
    WITH ledger AS (
      SELECT i.*, SUM(i."amount") OVER (ORDER BY i."posted_at", i."id") AS "running"
      FROM "folio_items" i
      WHERE i."folio_id" = ${folioId}::uuid AND i."property_id" = ${propertyId}::uuid
    )
    SELECT l."id", l."folio_id", l."kind"::text AS "kind", l."source"::text AS "source",
           l."business_date", l."revenue_date", l."posted_at", l."description", l."reference",
           l."comment", l."quantity"::text AS "quantity", l."unit_amount"::text AS "unit_amount",
           l."amount"::text AS "amount", l."running"::text AS "running_balance",
           l."parent_item_id", l."corrects_item_id", l."payment_id", l."refund_id",
           c."id" AS "code_id", c."code", c."name" AS "code_name",
           rc."code" AS "reason_code", u."display_name" AS "posted_by",
           EXISTS (SELECT 1 FROM "folio_items" r
                   WHERE r."corrects_item_id" = l."id" AND r."kind" = 'REVERSAL') AS "reversed",
           COALESCE((SELECT SUM(a."amount") FROM "folio_items" a
                     WHERE a."corrects_item_id" = l."id" AND a."kind" = 'ADJUSTMENT'), 0)::text AS "adjusted",
           p."receipt_number", p."status"::text AS "payment_status",
           p."business_date" AS "payment_business_date",
           (p."amount" - p."refunded_amount")::text AS "refundable",
           p."refunded_amount"::text AS "refunded", pm."name" AS "method_name"
    FROM ledger l
    JOIN "transaction_codes" c ON c."id" = l."transaction_code_id"
    LEFT JOIN "reason_codes" rc ON rc."id" = l."reason_code_id"
    LEFT JOIN "users" u ON u."id" = l."posted_by_id"
    LEFT JOIN "payments" p ON p."id" = l."payment_id"
    LEFT JOIN "payment_methods" pm ON pm."id" = p."method_id"
    ${cursor}
    ORDER BY l."posted_at", l."id"
    LIMIT ${limit + 1}`;
}

// --- Payments and refunds --------------------------------------------------------------------

export interface LockedPayment {
  id: string;
  folio_id: string | null;
  kind: string;
  status: string;
  amount: string;
  refunded_amount: string;
  currency_code: string;
  business_date: Date;
  method_id: string;
  receipt_number: string | null;
  version: number;
}

/** Locks a payment FOR UPDATE (after its folio: ARCHITECTURE §5, lock 10). */
export async function lockPayment(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<LockedPayment[]>`
    SELECT "id", "folio_id", "kind"::text AS "kind", "status"::text AS "status",
           "amount"::text AS "amount", "refunded_amount"::text AS "refunded_amount",
           "currency_code", "business_date", "method_id", "receipt_number", "version"
    FROM "payments"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

export function findPaymentRef(tx: Tx, propertyId: string, id: string) {
  return tx.payment.findFirst({
    where: { id, propertyId },
    select: { id: true, folioId: true, methodId: true },
  });
}

export function insertPayment(tx: Tx, data: Prisma.PaymentUncheckedCreateInput) {
  return tx.payment.create({ data, select: { id: true } });
}

export function updatePaymentVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.PaymentUncheckedUpdateManyInput,
) {
  return tx.payment.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

export function insertRefund(tx: Tx, data: Prisma.RefundUncheckedCreateInput) {
  return tx.refund.create({ data, select: { id: true } });
}

// --- Folio list ---------------------------------------------------------------------------

export interface FolioListSqlRow {
  reservation_room_id: string;
  confirmation_number: string;
  first_name: string;
  last_name: string;
  search_name: string;
  room_number: string | null;
  arrival_date: Date;
  departure_date: Date;
  stay_status: "IN_HOUSE" | "CHECKED_OUT" | null;
  windows: number;
  currency_code: string | null;
  balance: string;
  open_windows: number;
  settled_windows: number;
}

export function findFolioListPage(
  tx: Tx,
  propertyId: string,
  options: {
    view: "in_house" | "open_balance" | "all";
    search: { tokens: string[]; raw: string } | null;
    cursor: { v: string; i: string } | null;
    limit: number;
  },
) {
  const scope =
    options.view === "in_house"
      ? Prisma.sql`AND rr."status" = 'IN_HOUSE'`
      : Prisma.sql`AND EXISTS (SELECT 1 FROM "folios" x WHERE x."reservation_room_id" = rr."id")`;
  const search = options.search
    ? Prisma.sql`AND ((${
        options.search.tokens.length > 0
          ? Prisma.join(
              options.search.tokens.map((t) => Prisma.sql`g."search_name" LIKE ${`%${t}%`}`),
              " AND ",
            )
          : Prisma.sql`FALSE`
      }) OR res."confirmation_number" LIKE ${`${options.search.raw}%`}
          OR rm."number" = ${options.search.raw})`
    : Prisma.empty;
  const cursor = options.cursor
    ? Prisma.sql`AND (g."search_name", rr."id") > (${options.cursor.v}, ${options.cursor.i}::uuid)`
    : Prisma.empty;
  const having =
    options.view === "open_balance"
      ? Prisma.sql`HAVING COALESCE(SUM(f."balance"), 0) <> 0`
      : Prisma.empty;
  return tx.$queryRaw<FolioListSqlRow[]>`
    SELECT rr."id" AS "reservation_room_id", res."confirmation_number", g."first_name",
           g."last_name", g."search_name", rm."number" AS "room_number", rr."arrival_date",
           rr."departure_date", s."status"::text AS "stay_status",
           COUNT(f."id")::int AS "windows", MIN(f."currency_code") AS "currency_code",
           COALESCE(SUM(f."balance"), 0)::text AS "balance",
           COUNT(f."id") FILTER (WHERE f."status" = 'OPEN')::int AS "open_windows",
           COUNT(f."id") FILTER (WHERE f."status" = 'SETTLED')::int AS "settled_windows"
    FROM "reservation_rooms" rr
    JOIN "reservations" res ON res."id" = rr."reservation_id"
    JOIN "guests" g ON g."id" = rr."primary_guest_id"
    LEFT JOIN "rooms" rm ON rm."id" = rr."room_id"
    LEFT JOIN "stays" s ON s."reservation_room_id" = rr."id"
    LEFT JOIN "folios" f ON f."reservation_room_id" = rr."id"
    WHERE rr."property_id" = ${propertyId}::uuid
      ${scope}
      ${search}
      ${cursor}
    GROUP BY rr."id", res."confirmation_number", g."id", rm."number", s."status"
    ${having}
    ORDER BY g."search_name", rr."id"
    LIMIT ${options.limit + 1}`;
}
