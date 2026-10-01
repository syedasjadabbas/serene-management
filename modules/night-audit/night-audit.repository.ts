import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Night-audit data access. Every query is scoped by property; dates are
 * passed and returned as "YYYY-MM-DD" text (never through JS Date and the
 * process time zone). Money comes back as numeric text.
 */

// --- Business date ----------------------------------------------------------------------

/** The current business date row, locked FOR UPDATE (night audit is lock #1 in exclusive mode). */
export async function lockCurrentBusinessDateForUpdate(tx: Tx, propertyId: string) {
  const rows = await tx.$queryRaw<{ id: string; date: string; status: string }[]>`
    SELECT "id", "date"::text AS "date", "status"::text AS "status"
    FROM "business_dates"
    WHERE "property_id" = ${propertyId}::uuid AND "is_current"
    FOR UPDATE`;
  return rows[0] ?? null;
}

/** Same, but fails at once (SQLSTATE 55P03) when a commit holds the row. */
export async function lockCurrentBusinessDateNoWait(tx: Tx, propertyId: string) {
  const rows = await tx.$queryRaw<{ id: string; date: string; status: string }[]>`
    SELECT "id", "date"::text AS "date", "status"::text AS "status"
    FROM "business_dates"
    WHERE "property_id" = ${propertyId}::uuid AND "is_current"
    FOR UPDATE NOWAIT`;
  return rows[0] ?? null;
}

export function setBusinessDateStatus(tx: Tx, id: string, status: "OPEN" | "IN_AUDIT") {
  return tx.businessDate.update({ where: { id }, data: { status }, select: { id: true } });
}

/** Closes D and opens D+1 (the partial unique index allows one current row at a time). */
export async function rollBusinessDate(
  tx: Tx,
  input: { propertyId: string; currentId: string; nextDate: string; userId: string },
) {
  await tx.businessDate.update({
    where: { id: input.currentId },
    data: {
      status: "CLOSED",
      isCurrent: false,
      closedAt: new Date(),
      closedById: input.userId,
    },
  });
  return tx.businessDate.create({
    data: {
      propertyId: input.propertyId,
      date: new Date(`${input.nextDate}T00:00:00.000Z`),
      status: "OPEN",
      isCurrent: true,
    },
    select: { id: true },
  });
}

// --- Runs and steps ---------------------------------------------------------------------

export async function nextAttempt(tx: Tx, propertyId: string, businessDate: string) {
  const rows = await tx.$queryRaw<{ attempt: number }[]>`
    SELECT COALESCE(max("attempt"), 0)::int + 1 AS "attempt"
    FROM "night_audit_runs"
    WHERE "property_id" = ${propertyId}::uuid AND "business_date" = ${businessDate}::date`;
  return rows[0]!.attempt;
}

export function insertRun(
  tx: Tx,
  data: { propertyId: string; businessDate: string; attempt: number; startedById: string },
) {
  return tx.nightAuditRun.create({
    data: {
      propertyId: data.propertyId,
      businessDate: new Date(`${data.businessDate}T00:00:00.000Z`),
      attempt: data.attempt,
      status: "RUNNING",
      startedById: data.startedById,
    },
    select: { id: true },
  });
}

export async function lockRun(tx: Tx, propertyId: string, runId: string) {
  const rows = await tx.$queryRaw<
    { id: string; status: string; business_date: string; started_at: Date }[]
  >`
    SELECT "id", "status"::text AS "status", "business_date"::text AS "business_date", "started_at"
    FROM "night_audit_runs"
    WHERE "id" = ${runId}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

export function finishRun(
  tx: Tx,
  runId: string,
  data: {
    status: "COMPLETED" | "FAILED";
    errorCode?: string | null;
    errorMessage?: string | null;
    summary?: Prisma.InputJsonValue;
  },
) {
  return tx.nightAuditRun.update({
    where: { id: runId },
    data: {
      status: data.status,
      finishedAt: new Date(),
      errorCode: data.errorCode ?? null,
      errorMessage: data.errorMessage?.slice(0, 2000) ?? null,
      ...(data.summary !== undefined ? { summary: data.summary } : {}),
    },
    select: { id: true },
  });
}

export function insertSteps(tx: Tx, rows: Prisma.NightAuditStepCreateManyInput[]) {
  return tx.nightAuditStep.createMany({ data: rows });
}

const runSelect = {
  id: true,
  businessDate: true,
  attempt: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  startedById: true,
  errorCode: true,
  errorMessage: true,
  summary: true,
} as const satisfies Prisma.NightAuditRunSelect;

export function findRun(db: Tx, propertyId: string, runId: string) {
  return db.nightAuditRun.findFirst({
    where: { id: runId, propertyId },
    select: {
      ...runSelect,
      steps: {
        orderBy: { sequence: "asc" },
        select: {
          sequence: true,
          code: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          result: true,
          error: true,
        },
      },
    },
  });
}

export function findRunsPage(
  db: Tx,
  propertyId: string,
  take: number,
  cursor: { c: string; i: string } | null,
) {
  return db.nightAuditRun.findMany({
    where: {
      propertyId,
      ...(cursor
        ? {
            OR: [
              { startedAt: { lt: new Date(cursor.c) } },
              { startedAt: new Date(cursor.c), id: { lt: cursor.i } },
            ],
          }
        : {}),
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take,
    select: runSelect,
  });
}

export function findRunningRun(db: Tx, propertyId: string) {
  return db.nightAuditRun.findFirst({
    where: { propertyId, status: "RUNNING" },
    select: runSelect,
  });
}

export function findLastFinishedRun(db: Tx, propertyId: string) {
  return db.nightAuditRun.findFirst({
    where: { propertyId, status: { not: "RUNNING" } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: runSelect,
  });
}

// --- Configuration ------------------------------------------------------------------------

export async function findAuditConfiguration(db: Tx, propertyId: string) {
  const config = await db.propertyConfiguration.findUnique({
    where: { propertyId },
    select: {
      autoNoShowOnNightAudit: true,
      postNoShowCharges: true,
      noShowTransactionCodeId: true,
      noShowReasonCodeId: true,
    },
  });
  return (
    config ?? {
      autoNoShowOnNightAudit: true,
      postNoShowCharges: true,
      noShowTransactionCodeId: null,
      noShowReasonCodeId: null,
    }
  );
}

/** The configured automatic no-show reason, else the property's first active NO_SHOW code. */
export async function findNoShowReasonCode(
  db: Tx,
  propertyId: string,
  configuredId: string | null,
) {
  if (configuredId) {
    const configured = await db.reasonCode.findFirst({
      where: { id: configuredId, propertyId, category: "NO_SHOW", status: "ACTIVE" },
      select: { id: true, code: true },
    });
    if (configured) return configured;
  }
  return db.reasonCode.findFirst({
    where: { propertyId, category: "NO_SHOW", status: "ACTIVE" },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
}

// --- Phase B checks -------------------------------------------------------------------------

export interface StayCheckRow {
  reservation_room_id: string;
  reservation_id: string;
  stay_id: string | null;
  confirmation_number: string;
  line_number: number;
  room_number: string | null;
  guest_name: string;
  arrival: string;
  departure: string;
  guaranteed: boolean;
}

/** In-house rooms due out on or before D (checked out or extended before the audit). */
export function findOverdueDepartures(db: Tx, propertyId: string, businessDate: string) {
  return db.$queryRaw<StayCheckRow[]>`
    SELECT rr."id" AS "reservation_room_id", rr."reservation_id", s."id" AS "stay_id",
           res."confirmation_number", rr."line_number", r."number" AS "room_number",
           concat_ws(' ', g."first_name", g."last_name") AS "guest_name",
           rr."arrival_date"::text AS "arrival", rr."departure_date"::text AS "departure",
           t."is_guaranteed" AS "guaranteed"
    FROM "reservation_rooms" rr
    JOIN "reservations" res ON res."id" = rr."reservation_id"
    JOIN "reservation_types" t ON t."id" = rr."reservation_type_id"
    JOIN "guests" g ON g."id" = rr."primary_guest_id"
    LEFT JOIN "rooms" r ON r."id" = rr."room_id"
    LEFT JOIN "stays" s ON s."reservation_room_id" = rr."id" AND s."status" = 'IN_HOUSE'
    WHERE rr."property_id" = ${propertyId}::uuid AND rr."status" = 'IN_HOUSE'
      AND rr."departure_date" <= ${businessDate}::date
    ORDER BY rr."departure_date", r."number", rr."id"`;
}

/** Reserved rooms whose arrival is on or before D and that never checked in. */
export function findDueArrivals(db: Tx, propertyId: string, businessDate: string) {
  return db.$queryRaw<StayCheckRow[]>`
    SELECT rr."id" AS "reservation_room_id", rr."reservation_id", NULL::uuid AS "stay_id",
           res."confirmation_number", rr."line_number", r."number" AS "room_number",
           concat_ws(' ', g."first_name", g."last_name") AS "guest_name",
           rr."arrival_date"::text AS "arrival", rr."departure_date"::text AS "departure",
           t."is_guaranteed" AS "guaranteed"
    FROM "reservation_rooms" rr
    JOIN "reservations" res ON res."id" = rr."reservation_id"
    JOIN "reservation_types" t ON t."id" = rr."reservation_type_id"
    JOIN "guests" g ON g."id" = rr."primary_guest_id"
    LEFT JOIN "rooms" r ON r."id" = rr."room_id"
    WHERE rr."property_id" = ${propertyId}::uuid AND rr."status" = 'RESERVED'
      AND rr."arrival_date" <= ${businessDate}::date
    ORDER BY rr."arrival_date", res."confirmation_number", rr."line_number"`;
}

/**
 * Folios whose stored totals disagree with their ledger. Checks the folios
 * that can still change — every folio not CLOSED, and any folio with a line
 * dated D — instead of re-summing the property's whole history on every
 * readiness view (B4). A CLOSED folio is final: the database refuses
 * postings into it (SM002) and the ledger is append-only (SM001), so its
 * totals cannot drift through any application path.
 *
 * The ledger sums are one aggregate over the candidates' lines (scalability
 * phase 6B, docs/SCALABILITY.md §34) instead of one correlated sum per
 * folio: with 200,000 SETTLED folios that was 200,000 index probes and
 * ≈ 1.3 M buffer reads (5–9 s, over the 30 s statement timeout cold). The
 * result is the same, row for row (tests/db/night-audit-balances.test.ts):
 * a folio without lines has ledger 0, as before. `i.property_id` is
 * redundant — lines reference their folio through (property_id, folio_id) —
 * and lets the scan use the property's index.
 */
export function findUnbalancedFolios(db: Tx, propertyId: string, businessDate: string) {
  return db.$queryRaw<
    {
      id: string;
      reservation_room_id: string | null;
      window: number;
      balance: string;
      ledger: string;
    }[]
  >`
    WITH candidates AS MATERIALIZED (
      SELECT f."id", f."reservation_room_id", f."window", f."balance", f."charges_total",
             f."credits_total"
      FROM "folios" f
      WHERE f."property_id" = ${propertyId}::uuid
        AND (f."status" <> 'CLOSED'
             OR EXISTS (SELECT 1 FROM "folio_items" d
                        WHERE d."folio_id" = f."id" AND d."property_id" = ${propertyId}::uuid
                          AND d."business_date" = ${businessDate}::date))
    ), ledger AS (
      SELECT i."folio_id", sum(i."amount") AS "ledger"
      FROM "folio_items" i
      WHERE i."property_id" = ${propertyId}::uuid
        AND i."folio_id" IN (SELECT "id" FROM candidates)
      GROUP BY i."folio_id"
    )
    SELECT c."id", c."reservation_room_id", c."window", c."balance"::text AS "balance",
           COALESCE(l."ledger", 0)::text AS "ledger"
    FROM candidates c
    LEFT JOIN ledger l ON l."folio_id" = c."id"
    WHERE c."balance" <> COALESCE(l."ledger", 0)
       OR c."balance" <> c."charges_total" + c."credits_total"
    ORDER BY c."id"`;
}

/** Payments and refunds of D whose ledger line is missing or does not match. */
export function findPaymentMismatches(db: Tx, propertyId: string, businessDate: string) {
  return db.$queryRaw<{ id: string; folio_id: string; receipt_number: string; problem: string }[]>`
    SELECT p."id", p."folio_id", p."receipt_number", 'LEDGER_LINE_MISSING' AS "problem"
    FROM "payments" p
    WHERE p."property_id" = ${propertyId}::uuid AND p."business_date" = ${businessDate}::date
      AND NOT EXISTS (
        SELECT 1 FROM "folio_items" i
        WHERE i."payment_id" = p."id" AND i."kind" = 'PAYMENT' AND i."refund_id" IS NULL
          AND i."amount" = -p."amount")
    UNION ALL
    SELECT p."id", p."folio_id", p."receipt_number", 'VOID_NOT_REVERSED'
    FROM "payments" p
    WHERE p."property_id" = ${propertyId}::uuid AND p."business_date" = ${businessDate}::date
      AND p."status" = 'VOIDED'
      AND NOT EXISTS (
        SELECT 1 FROM "folio_items" i
        JOIN "folio_items" r ON r."corrects_item_id" = i."id" AND r."kind" = 'REVERSAL'
        WHERE i."payment_id" = p."id" AND i."kind" = 'PAYMENT' AND i."refund_id" IS NULL)
    UNION ALL
    SELECT f."id", p."folio_id", p."receipt_number", 'REFUND_LINE_MISSING'
    FROM "refunds" f
    JOIN "payments" p ON p."id" = f."payment_id"
    WHERE f."property_id" = ${propertyId}::uuid AND f."business_date" = ${businessDate}::date
      AND f."status" = 'SUCCEEDED'
      AND NOT EXISTS (
        SELECT 1 FROM "folio_items" i WHERE i."refund_id" = f."id" AND i."amount" = f."amount")`;
}

/** Occupied rooms without an in-house stay, and in-house stays in a room not marked occupied. */
export function findRoomStatusDiscrepancies(db: Tx, propertyId: string) {
  return db.$queryRaw<
    { room_id: string; room_number: string; stay_id: string | null; problem: string }[]
  >`
    SELECT r."id" AS "room_id", r."number" AS "room_number", NULL::uuid AS "stay_id",
           'OCCUPIED_WITHOUT_STAY' AS "problem"
    FROM "rooms" r
    WHERE r."property_id" = ${propertyId}::uuid AND r."front_office_status" = 'OCCUPIED'
      AND NOT EXISTS (SELECT 1 FROM "stays" s WHERE s."room_id" = r."id" AND s."status" = 'IN_HOUSE')
    UNION ALL
    SELECT r."id", r."number", s."id", 'STAY_IN_VACANT_ROOM'
    FROM "stays" s
    JOIN "rooms" r ON r."id" = s."room_id"
    WHERE s."property_id" = ${propertyId}::uuid AND s."status" = 'IN_HOUSE'
      AND r."front_office_status" <> 'OCCUPIED'
    ORDER BY 2`;
}

/** Stays with nights before D that carry no room charge yet. */
export function findUnpostedNights(db: Tx, propertyId: string, businessDate: string) {
  return db.$queryRaw<
    {
      reservation_room_id: string;
      reservation_id: string;
      status: string;
      confirmation_number: string;
      line_number: number;
      guest_name: string;
      nights: number;
    }[]
  >`
    SELECT rr."id" AS "reservation_room_id", rr."reservation_id", rr."status"::text AS "status",
           res."confirmation_number", rr."line_number",
           concat_ws(' ', g."first_name", g."last_name") AS "guest_name",
           count(*)::int AS "nights"
    FROM "reservation_room_nights" n
    JOIN "reservation_rooms" rr ON rr."id" = n."reservation_room_id"
    JOIN "reservations" res ON res."id" = rr."reservation_id"
    JOIN "guests" g ON g."id" = rr."primary_guest_id"
    WHERE n."property_id" = ${propertyId}::uuid AND n."posted_at" IS NULL
      AND n."stay_date" < ${businessDate}::date
      AND rr."status" IN ('IN_HOUSE', 'CHECKED_OUT')
    GROUP BY rr."id", res."confirmation_number", g."first_name", g."last_name"
    ORDER BY rr."status", res."confirmation_number", rr."line_number"`;
}

// --- Phase C selections ---------------------------------------------------------------------

export async function findInHouseReservationRoomIds(tx: Tx, propertyId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "reservation_rooms"
    WHERE "property_id" = ${propertyId}::uuid AND "status" = 'IN_HOUSE'
    ORDER BY "id"`;
  return rows.map((row) => row.id);
}

export async function findNoShowCandidateIds(tx: Tx, propertyId: string, businessDate: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "reservation_rooms"
    WHERE "property_id" = ${propertyId}::uuid AND "status" = 'RESERVED'
      AND "arrival_date" <= ${businessDate}::date
    ORDER BY "id"`;
  return rows.map((row) => row.id);
}

// --- Statistics (Phase C, set-based) ------------------------------------------------------------

export interface RoomCountRow {
  physical_rooms: number;
  out_of_order_rooms: number;
  out_of_service_rooms: number;
  rooms_sold: number;
  complimentary_rooms: number;
  house_use_rooms: number;
  day_use_rooms: number;
  arrivals: number;
  departures: number;
  stayovers: number;
  no_shows: number;
  cancellations: number;
  walk_ins: number;
  adults: number;
  children: number;
}

/**
 * House room counts for night D (docs/DATABASE_DESIGN.md §8). Taken after
 * no-shows, before the service-block roll (a block ending tonight still
 * held its room for night D).
 *   sold      = distinct rooms occupied tonight by in-house guests (shares once)
 *   comp/house use = sold rooms on complimentary / house-use rate plans
 *   day use   = day-use stays that arrived on D
 *   arrivals / departures / walk-ins = stays that started / ended on D
 *   stayovers = rooms sold tonight by guests who arrived before D
 */
export async function countRoomsForNight(tx: Tx, propertyId: string, businessDate: string) {
  const rows = await tx.$queryRaw<RoomCountRow[]>`
    WITH tonight AS (
      SELECT rr."id", rr."room_id", rr."room_type_id", n."adults", n."children",
             p."kind"::text AS "plan_kind", p."is_complimentary",
             s."arrival_business_date"
      FROM "reservation_room_nights" n
      JOIN "reservation_rooms" rr ON rr."id" = n."reservation_room_id"
      JOIN "rate_plans" p ON p."id" = n."rate_plan_id"
      JOIN "stays" s ON s."reservation_room_id" = rr."id" AND s."status" = 'IN_HOUSE'
      WHERE n."property_id" = ${propertyId}::uuid AND n."stay_date" = ${businessDate}::date
        AND rr."status" = 'IN_HOUSE'
    ),
    physical AS (
      SELECT r."id" FROM "rooms" r
      JOIN "room_types" rt ON rt."id" = r."room_type_id"
      WHERE r."property_id" = ${propertyId}::uuid AND r."status" = 'ACTIVE' AND NOT rt."is_pseudo"
    ),
    blocked AS (
      SELECT b."kind"::text AS "kind", count(DISTINCT b."room_id")::int AS "rooms"
      FROM "room_service_blocks" b
      WHERE b."property_id" = ${propertyId}::uuid AND b."status" IN ('SCHEDULED', 'ACTIVE')
        AND b."from_date" <= ${businessDate}::date AND b."to_date" > ${businessDate}::date
      GROUP BY 1
    )
    SELECT
      (SELECT count(*) FROM physical)::int AS "physical_rooms",
      COALESCE((SELECT "rooms" FROM blocked WHERE "kind" = 'OUT_OF_ORDER'), 0)::int AS "out_of_order_rooms",
      COALESCE((SELECT "rooms" FROM blocked WHERE "kind" = 'OUT_OF_SERVICE'), 0)::int AS "out_of_service_rooms",
      (SELECT count(DISTINCT "room_id") FROM tonight)::int AS "rooms_sold",
      (SELECT count(DISTINCT "room_id") FROM tonight
         WHERE "is_complimentary" OR "plan_kind" = 'COMPLIMENTARY')::int AS "complimentary_rooms",
      (SELECT count(DISTINCT "room_id") FROM tonight WHERE "plan_kind" = 'HOUSE_USE')::int AS "house_use_rooms",
      (SELECT count(*) FROM "stays" s JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
         WHERE s."property_id" = ${propertyId}::uuid AND rr."is_day_use"
           AND s."arrival_business_date" = ${businessDate}::date)::int AS "day_use_rooms",
      (SELECT count(*) FROM "stays" s
         WHERE s."property_id" = ${propertyId}::uuid
           AND s."arrival_business_date" = ${businessDate}::date)::int AS "arrivals",
      (SELECT count(*) FROM "stays" s
         WHERE s."property_id" = ${propertyId}::uuid
           AND s."departure_business_date" = ${businessDate}::date)::int AS "departures",
      (SELECT count(DISTINCT "room_id") FROM tonight
         WHERE "arrival_business_date" < ${businessDate}::date)::int AS "stayovers",
      (SELECT count(*) FROM "reservation_rooms" rr
         WHERE rr."property_id" = ${propertyId}::uuid
           AND rr."no_show_business_date" = ${businessDate}::date)::int AS "no_shows",
      (SELECT count(*) FROM "reservation_rooms" rr
         WHERE rr."property_id" = ${propertyId}::uuid
           AND rr."cancellation_business_date" = ${businessDate}::date)::int AS "cancellations",
      (SELECT count(*) FROM "stays" s JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
         WHERE s."property_id" = ${propertyId}::uuid AND rr."is_walk_in"
           AND s."arrival_business_date" = ${businessDate}::date)::int AS "walk_ins",
      COALESCE((SELECT sum("adults") FROM tonight), 0)::int AS "adults",
      COALESCE((SELECT sum("children") FROM tonight), 0)::int AS "children"`;
  return rows[0]!;
}

export interface RoomTypeCountRow {
  room_type_id: string;
  physical_rooms: number;
  out_of_order_rooms: number;
  rooms_sold: number;
  arrivals: number;
  departures: number;
}

/** The same counts per (non-pseudo) room type; sold by the booked room type. */
export function countRoomTypesForNight(tx: Tx, propertyId: string, businessDate: string) {
  return tx.$queryRaw<RoomTypeCountRow[]>`
    SELECT rt."id" AS "room_type_id",
      (SELECT count(*) FROM "rooms" r
         WHERE r."room_type_id" = rt."id" AND r."status" = 'ACTIVE')::int AS "physical_rooms",
      (SELECT count(DISTINCT b."room_id") FROM "room_service_blocks" b
         JOIN "rooms" r ON r."id" = b."room_id"
         WHERE r."room_type_id" = rt."id" AND b."kind" = 'OUT_OF_ORDER'
           AND b."status" IN ('SCHEDULED', 'ACTIVE')
           AND b."from_date" <= ${businessDate}::date AND b."to_date" > ${businessDate}::date)::int
        AS "out_of_order_rooms",
      (SELECT count(DISTINCT rr."room_id") FROM "reservation_room_nights" n
         JOIN "reservation_rooms" rr ON rr."id" = n."reservation_room_id"
         JOIN "stays" s ON s."reservation_room_id" = rr."id" AND s."status" = 'IN_HOUSE'
         WHERE n."stay_date" = ${businessDate}::date AND rr."status" = 'IN_HOUSE'
           AND rr."room_type_id" = rt."id")::int AS "rooms_sold",
      (SELECT count(*) FROM "stays" s JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
         WHERE rr."room_type_id" = rt."id"
           AND s."arrival_business_date" = ${businessDate}::date)::int AS "arrivals",
      (SELECT count(*) FROM "stays" s JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
         WHERE rr."room_type_id" = rt."id"
           AND s."departure_business_date" = ${businessDate}::date)::int AS "departures"
    FROM "room_types" rt
    WHERE rt."property_id" = ${propertyId}::uuid AND NOT rt."is_pseudo" AND rt."status" = 'ACTIVE'
    ORDER BY rt."id"`;
}

export interface MoneyRow {
  room_revenue: string;
  package_revenue: string;
  other_revenue: string;
  tax_total: string;
  no_show_revenue: string;
  adjustments_total: string;
  payments_total: string;
  voids_total: string;
  refunds_total: string;
}

/**
 * Money of business date D from the ledger (D32), net of same-day
 * reversals and adjustments, by revenue bucket of the transaction code:
 * ROOM (without the no-show fee code), PACKAGE, TAX; everything else that
 * is revenue is "other". Payments, voids and refunds come from their own
 * tables. Reads only D's rows: dashboards and live reports call it on every
 * poll (H8). The guest-ledger roll-forward is `ledgerBalancesForDate`.
 */
export async function sumMoneyForDate(
  tx: Tx,
  propertyId: string,
  businessDate: string,
  noShowCodeId: string | null,
) {
  const rows = await tx.$queryRaw<MoneyRow[]>`
    WITH lines AS (
      SELECT i."amount", i."kind"::text AS "kind", tc."bucket"::text AS "bucket", i."transaction_code_id"
      FROM "folio_items" i
      JOIN "transaction_codes" tc ON tc."id" = i."transaction_code_id"
      WHERE i."property_id" = ${propertyId}::uuid AND i."business_date" = ${businessDate}::date
        AND i."kind" IN ('CHARGE', 'TAX', 'ADJUSTMENT', 'REVERSAL')
        AND tc."bucket" NOT IN ('PAYMENT', 'NON_REVENUE')
    )
    SELECT
      COALESCE(sum("amount") FILTER (WHERE "bucket" = 'ROOM'
        AND "transaction_code_id" IS DISTINCT FROM ${noShowCodeId}::uuid), 0)::text AS "room_revenue",
      COALESCE(sum("amount") FILTER (WHERE "bucket" = 'PACKAGE'), 0)::text AS "package_revenue",
      COALESCE(sum("amount") FILTER (WHERE "bucket" NOT IN ('ROOM', 'PACKAGE', 'TAX')
        AND "transaction_code_id" IS DISTINCT FROM ${noShowCodeId}::uuid), 0)::text AS "other_revenue",
      COALESCE(sum("amount") FILTER (WHERE "bucket" = 'TAX'), 0)::text AS "tax_total",
      COALESCE(sum("amount") FILTER (WHERE "transaction_code_id" = ${noShowCodeId}::uuid), 0)::text
        AS "no_show_revenue",
      (SELECT COALESCE(sum(i."amount"), 0) FROM "folio_items" i
         WHERE i."property_id" = ${propertyId}::uuid AND i."business_date" = ${businessDate}::date
           AND i."kind" = 'ADJUSTMENT')::text AS "adjustments_total",
      (SELECT COALESCE(sum(p."amount"), 0) FROM "payments" p
         WHERE p."property_id" = ${propertyId}::uuid AND p."business_date" = ${businessDate}::date
           AND p."status" = 'CAPTURED')::text AS "payments_total",
      (SELECT COALESCE(sum(p."amount"), 0) FROM "payments" p
         WHERE p."property_id" = ${propertyId}::uuid AND p."business_date" = ${businessDate}::date
           AND p."status" = 'VOIDED')::text AS "voids_total",
      (SELECT COALESCE(sum(r."amount"), 0) FROM "refunds" r
         WHERE r."property_id" = ${propertyId}::uuid AND r."business_date" = ${businessDate}::date
           AND r."status" = 'SUCCEEDED')::text AS "refunds_total"
    FROM lines`;
  return rows[0]!;
}

/**
 * Guest-ledger roll-forward of D (night audit STATISTICS): opening = Σ ledger
 * before D, closing = opening + D's lines. The opening is the previous closed
 * day's stored closing balance when that snapshot exists — exact, because
 * the posting-date guard refuses lines dated into a closed business date —
 * and a full-history sum only when it does not (first audit, or gaps).
 * COALESCE evaluates the fallback only when needed (H8).
 */
export async function ledgerBalancesForDate(tx: Tx, propertyId: string, businessDate: string) {
  const rows = await tx.$queryRaw<{ ledger_opening: string; ledger_closing: string }[]>`
    WITH opening AS (
      SELECT COALESCE(
        (SELECT s."ledger_closing_balance" FROM "daily_statistics" s
          WHERE s."property_id" = ${propertyId}::uuid
            AND s."business_date" = ${businessDate}::date - 1),
        (SELECT COALESCE(sum(i."amount"), 0) FROM "folio_items" i
          WHERE i."property_id" = ${propertyId}::uuid
            AND i."business_date" < ${businessDate}::date)
      ) AS "amount"
    ), movement AS (
      SELECT COALESCE(sum(i."amount"), 0) AS "amount" FROM "folio_items" i
      WHERE i."property_id" = ${propertyId}::uuid AND i."business_date" = ${businessDate}::date
    )
    SELECT o."amount"::text AS "ledger_opening", (o."amount" + m."amount")::text AS "ledger_closing"
    FROM opening o, movement m`;
  return rows[0]!;
}

/** Room revenue of D per booked room type (ledger lines of the ROOM bucket). */
export function sumRoomRevenueByType(
  tx: Tx,
  propertyId: string,
  businessDate: string,
  noShowCodeId: string | null,
) {
  return tx.$queryRaw<{ room_type_id: string; room_revenue: string }[]>`
    SELECT rr."room_type_id", COALESCE(sum(i."amount"), 0)::text AS "room_revenue"
    FROM "folio_items" i
    JOIN "transaction_codes" tc ON tc."id" = i."transaction_code_id"
    JOIN "reservation_rooms" rr ON rr."id" = i."origin_reservation_room_id"
    WHERE i."property_id" = ${propertyId}::uuid AND i."business_date" = ${businessDate}::date
      AND i."kind" IN ('CHARGE', 'ADJUSTMENT', 'REVERSAL') AND tc."bucket" = 'ROOM'
      AND i."transaction_code_id" IS DISTINCT FROM ${noShowCodeId}::uuid
    GROUP BY rr."room_type_id"`;
}
