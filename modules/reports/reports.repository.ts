import "server-only";
import type { Tx } from "@/lib/db/prisma";

/**
 * Report queries (docs/ARCHITECTURE.md D32, DATABASE_DESIGN.md §8): database
 * aggregation only, scoped by property. Closed dates are immutable, so the
 * ledger by business date and the daily statistics snapshots are stable
 * history; the open date is read live. Dates come back as "YYYY-MM-DD"
 * text, money as numeric text (never JS numbers).
 */

type Range = { propertyId: string; from: string; to: string };

// --- Statistics snapshots ------------------------------------------------------------------

export interface StatisticsRow {
  business_date: string;
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
  room_revenue: string;
  package_revenue: string;
  other_revenue: string;
  tax_total: string;
  no_show_revenue: string;
  payments_total: string;
  voids_total: string;
  refunds_total: string;
  adjustments_total: string;
  ledger_opening_balance: string;
  ledger_closing_balance: string;
}

export function findStatistics(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<StatisticsRow[]>`
    SELECT "business_date"::text AS "business_date", "physical_rooms", "out_of_order_rooms",
           "out_of_service_rooms", "rooms_sold", "complimentary_rooms", "house_use_rooms",
           "day_use_rooms", "arrivals", "departures", "stayovers", "no_shows", "cancellations",
           "walk_ins", "adults", "children",
           "room_revenue"::text AS "room_revenue", "package_revenue"::text AS "package_revenue",
           "other_revenue"::text AS "other_revenue", "tax_total"::text AS "tax_total",
           "no_show_revenue"::text AS "no_show_revenue", "payments_total"::text AS "payments_total",
           "voids_total"::text AS "voids_total", "refunds_total"::text AS "refunds_total",
           "adjustments_total"::text AS "adjustments_total",
           "ledger_opening_balance"::text AS "ledger_opening_balance",
           "ledger_closing_balance"::text AS "ledger_closing_balance"
    FROM "daily_statistics"
    WHERE "property_id" = ${propertyId}::uuid
      AND "business_date" BETWEEN ${from}::date AND ${to}::date
    ORDER BY "business_date"`;
}

export function findRoomTypeStatistics(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      room_type_id: string;
      code: string;
      name: string;
      physical_rooms: number;
      out_of_order_rooms: number;
      rooms_sold: number;
      arrivals: number;
      departures: number;
      room_revenue: string;
      days: number;
    }[]
  >`
    SELECT s."room_type_id", rt."code", rt."name",
           sum(s."physical_rooms")::int AS "physical_rooms",
           sum(s."out_of_order_rooms")::int AS "out_of_order_rooms",
           sum(s."rooms_sold")::int AS "rooms_sold", sum(s."arrivals")::int AS "arrivals",
           sum(s."departures")::int AS "departures", sum(s."room_revenue")::text AS "room_revenue",
           count(*)::int AS "days"
    FROM "daily_room_type_statistics" s
    JOIN "room_types" rt ON rt."id" = s."room_type_id"
    WHERE s."property_id" = ${propertyId}::uuid
      AND s."business_date" BETWEEN ${from}::date AND ${to}::date
    GROUP BY s."room_type_id", rt."code", rt."name", rt."sort_order"
    ORDER BY rt."sort_order", rt."code"`;
}

// --- Operations --------------------------------------------------------------------------------

export interface StayListRow {
  reservation_room_id: string;
  reservation_id: string;
  confirmation_number: string;
  line_number: number;
  guest_name: string;
  status: string;
  room_type: string;
  room_number: string | null;
  rate_plan: string;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  company: string | null;
  group_code: string | null;
  is_vip: boolean;
}

const stayListSelect = `
  SELECT rr."id" AS "reservation_room_id", rr."reservation_id", res."confirmation_number",
         rr."line_number", concat_ws(' ', g."first_name", g."last_name") AS "guest_name",
         rr."status"::text AS "status", rt."code" AS "room_type", r."number" AS "room_number",
         rp."code" AS "rate_plan", rr."arrival_date"::text AS "arrival",
         rr."departure_date"::text AS "departure",
         (rr."departure_date" - rr."arrival_date")::int AS "nights", rr."adults", rr."children",
         co."name" AS "company", gr."code" AS "group_code", (g."vip_level_id" IS NOT NULL) AS "is_vip"
  FROM "reservation_rooms" rr
  JOIN "reservations" res ON res."id" = rr."reservation_id"
  JOIN "guests" g ON g."id" = rr."primary_guest_id"
  JOIN "room_types" rt ON rt."id" = rr."room_type_id"
  JOIN "rate_plans" rp ON rp."id" = rr."rate_plan_id"
  LEFT JOIN "rooms" r ON r."id" = rr."room_id"
  LEFT JOIN "account_profiles" co ON co."id" = res."company_id"
  LEFT JOIN "groups" gr ON gr."id" = res."group_id"`;

/** Arrivals (expected or arrived) between two dates, optionally for one room type. */
export function findArrivalsBetween(db: Tx, range: Range, roomTypeId: string | null) {
  return db.$queryRawUnsafe<StayListRow[]>(
    `${stayListSelect}
     WHERE rr."property_id" = $1::uuid AND rr."arrival_date" BETWEEN $2::date AND $3::date
       AND rr."status" IN ('RESERVED', 'IN_HOUSE', 'CHECKED_OUT')
       AND ($4::uuid IS NULL OR rr."room_type_id" = $4::uuid)
     ORDER BY rr."arrival_date", res."confirmation_number", rr."line_number"`,
    range.propertyId,
    range.from,
    range.to,
    roomTypeId,
  );
}

/** Departures (due or departed) between two dates. */
export function findDeparturesBetween(db: Tx, range: Range, roomTypeId: string | null) {
  return db.$queryRawUnsafe<StayListRow[]>(
    `${stayListSelect}
     WHERE rr."property_id" = $1::uuid AND rr."departure_date" BETWEEN $2::date AND $3::date
       AND rr."status" IN ('RESERVED', 'IN_HOUSE', 'CHECKED_OUT')
       AND ($4::uuid IS NULL OR rr."room_type_id" = $4::uuid)
     ORDER BY rr."departure_date", r."number", res."confirmation_number"`,
    range.propertyId,
    range.from,
    range.to,
    roomTypeId,
  );
}

/** Guests in house now. */
export function findInHouse(db: Tx, propertyId: string, roomTypeId: string | null) {
  return db.$queryRawUnsafe<StayListRow[]>(
    `${stayListSelect}
     WHERE rr."property_id" = $1::uuid AND rr."status" = 'IN_HOUSE'
       AND ($2::uuid IS NULL OR rr."room_type_id" = $2::uuid)
     ORDER BY r."number", res."confirmation_number"`,
    propertyId,
    roomTypeId,
  );
}

export function findNoShowsBetween(db: Tx, range: Range) {
  return db.$queryRawUnsafe<(StayListRow & { business_date: string; guaranteed: boolean })[]>(
    `SELECT sl.*, rr2."no_show_business_date"::text AS "business_date", t."is_guaranteed" AS "guaranteed"
     FROM (${stayListSelect}) sl
     JOIN "reservation_rooms" rr2 ON rr2."id" = sl."reservation_room_id"
     JOIN "reservation_types" t ON t."id" = rr2."reservation_type_id"
     WHERE rr2."property_id" = $1::uuid
       AND rr2."no_show_business_date" BETWEEN $2::date AND $3::date
     ORDER BY rr2."no_show_business_date", sl."confirmation_number"`,
    range.propertyId,
    range.from,
    range.to,
  );
}

export function findCancellationsBetween(db: Tx, range: Range) {
  return db.$queryRawUnsafe<
    (StayListRow & {
      business_date: string;
      cancellation_number: string | null;
      reason: string | null;
    })[]
  >(
    `SELECT sl.*, rr2."cancellation_business_date"::text AS "business_date",
            rr2."cancellation_number", rc."name" AS "reason"
     FROM (${stayListSelect}) sl
     JOIN "reservation_rooms" rr2 ON rr2."id" = sl."reservation_room_id"
     LEFT JOIN "reason_codes" rc ON rc."id" = rr2."cancel_reason_id"
     WHERE rr2."property_id" = $1::uuid
       AND rr2."cancellation_business_date" BETWEEN $2::date AND $3::date
     ORDER BY rr2."cancellation_business_date", sl."confirmation_number"`,
    range.propertyId,
    range.from,
    range.to,
  );
}

/** Current status of every room (the room board as a report). */
export function findRoomStatus(db: Tx, propertyId: string, businessDate: string) {
  return db.$queryRaw<
    {
      number: string;
      room_type: string;
      floor: string | null;
      front_office_status: string;
      housekeeping_status: string;
      service_status: string;
      guest_name: string | null;
      departure: string | null;
      block_until: string | null;
    }[]
  >`
    SELECT r."number", rt."code" AS "room_type", f."code" AS "floor",
           r."front_office_status"::text AS "front_office_status",
           r."housekeeping_status"::text AS "housekeeping_status",
           r."service_status"::text AS "service_status",
           (SELECT concat_ws(' ', g."first_name", g."last_name")
              FROM "stays" s JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
              JOIN "guests" g ON g."id" = rr."primary_guest_id"
             WHERE s."room_id" = r."id" AND s."status" = 'IN_HOUSE' LIMIT 1) AS "guest_name",
           (SELECT rr."departure_date"::text
              FROM "stays" s JOIN "reservation_rooms" rr ON rr."id" = s."reservation_room_id"
             WHERE s."room_id" = r."id" AND s."status" = 'IN_HOUSE' LIMIT 1) AS "departure",
           (SELECT b."to_date"::text FROM "room_service_blocks" b
             WHERE b."room_id" = r."id" AND b."status" IN ('SCHEDULED', 'ACTIVE')
               AND b."from_date" <= ${businessDate}::date AND b."to_date" > ${businessDate}::date
             LIMIT 1) AS "block_until"
    FROM "rooms" r
    JOIN "room_types" rt ON rt."id" = r."room_type_id"
    LEFT JOIN "floors" f ON f."id" = r."floor_id"
    WHERE r."property_id" = ${propertyId}::uuid AND r."status" = 'ACTIVE' AND NOT rt."is_pseudo"
    ORDER BY r."number"`;
}

export function findHousekeepingTasks(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      business_date: string;
      room_number: string;
      task_type: string;
      status: string;
      priority: number;
      attendant: string | null;
      completed_at: Date | null;
      credits: string;
    }[]
  >`
    SELECT t."business_date"::text AS "business_date", r."number" AS "room_number",
           tt."name" AS "task_type", t."status"::text AS "status", t."priority",
           a."name" AS "attendant", t."completed_at", t."credits"::text AS "credits"
    FROM "housekeeping_tasks" t
    JOIN "rooms" r ON r."id" = t."room_id"
    JOIN "housekeeping_task_types" tt ON tt."id" = t."task_type_id"
    LEFT JOIN "housekeeping_attendants" a ON a."id" = t."attendant_id"
    WHERE t."property_id" = ${propertyId}::uuid
      AND t."business_date" BETWEEN ${from}::date AND ${to}::date
    ORDER BY t."business_date", r."number", tt."name"`;
}

// --- Finance ---------------------------------------------------------------------------------

/** Ledger lines by transaction code: charges, corrections and net (D9: reversals net out). */
export function sumByTransactionCode(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      code: string;
      name: string;
      bucket: string;
      group_type: string;
      lines: number;
      posted: string;
      reversed: string;
      adjusted: string;
      net: string;
    }[]
  >`
    SELECT tc."code", tc."name", tc."bucket"::text AS "bucket", g."type"::text AS "group_type",
           count(*) FILTER (WHERE i."kind" IN ('CHARGE', 'TAX', 'PAYMENT'))::int AS "lines",
           COALESCE(sum(i."amount") FILTER (WHERE i."kind" IN ('CHARGE', 'TAX', 'PAYMENT')), 0)::text AS "posted",
           COALESCE(sum(i."amount") FILTER (WHERE i."kind" = 'REVERSAL'), 0)::text AS "reversed",
           COALESCE(sum(i."amount") FILTER (WHERE i."kind" = 'ADJUSTMENT'), 0)::text AS "adjusted",
           COALESCE(sum(i."amount"), 0)::text AS "net"
    FROM "folio_items" i
    JOIN "transaction_codes" tc ON tc."id" = i."transaction_code_id"
    JOIN "transaction_code_groups" g ON g."id" = tc."group_id"
    WHERE i."property_id" = ${propertyId}::uuid
      AND i."business_date" BETWEEN ${from}::date AND ${to}::date
    GROUP BY tc."code", tc."name", tc."bucket", g."type", g."sort_order"
    ORDER BY g."type", g."sort_order", tc."code"`;
}

/** Tax collected by tax code, with the taxable base of the lines that generated it. */
export function sumTaxes(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      code: string;
      name: string;
      lines: number;
      base: string;
      tax: string;
      corrections: string;
      net: string;
    }[]
  >`
    SELECT tc."code", tc."name",
           count(*) FILTER (WHERE i."kind" = 'TAX')::int AS "lines",
           COALESCE(sum(p."amount") FILTER (WHERE i."kind" = 'TAX'), 0)::text AS "base",
           COALESCE(sum(i."amount") FILTER (WHERE i."kind" = 'TAX'), 0)::text AS "tax",
           COALESCE(sum(i."amount") FILTER (WHERE i."kind" <> 'TAX'), 0)::text AS "corrections",
           COALESCE(sum(i."amount"), 0)::text AS "net"
    FROM "folio_items" i
    JOIN "transaction_codes" tc ON tc."id" = i."transaction_code_id"
    LEFT JOIN "folio_items" p ON p."id" = i."parent_item_id"
    WHERE i."property_id" = ${propertyId}::uuid
      AND i."business_date" BETWEEN ${from}::date AND ${to}::date
      AND tc."bucket" = 'TAX'
    GROUP BY tc."code", tc."name"
    ORDER BY tc."code"`;
}

/** Payments by method: captured, voided, refunded, net. */
export function sumPaymentsByMethod(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      method: string;
      name: string;
      payments: number;
      captured: string;
      voided: string;
      refunds: number;
      refunded: string;
      net: string;
    }[]
  >`
    WITH p AS (
      SELECT "method_id",
             count(*)::int AS "payments",
             COALESCE(sum("amount") FILTER (WHERE "status" = 'CAPTURED'), 0) AS "captured",
             COALESCE(sum("amount") FILTER (WHERE "status" = 'VOIDED'), 0) AS "voided"
      FROM "payments"
      WHERE "property_id" = ${propertyId}::uuid
        AND "business_date" BETWEEN ${from}::date AND ${to}::date
      GROUP BY "method_id"
    ),
    r AS (
      SELECT pay."method_id", count(*)::int AS "refunds", COALESCE(sum(f."amount"), 0) AS "refunded"
      FROM "refunds" f
      JOIN "payments" pay ON pay."id" = f."payment_id"
      WHERE f."property_id" = ${propertyId}::uuid AND f."status" = 'SUCCEEDED'
        AND f."business_date" BETWEEN ${from}::date AND ${to}::date
      GROUP BY pay."method_id"
    )
    SELECT m."code" AS "method", m."name",
           COALESCE(p."payments", 0)::int AS "payments",
           COALESCE(p."captured", 0)::text AS "captured",
           COALESCE(p."voided", 0)::text AS "voided",
           COALESCE(r."refunds", 0)::int AS "refunds",
           COALESCE(r."refunded", 0)::text AS "refunded",
           (COALESCE(p."captured", 0) - COALESCE(r."refunded", 0))::text AS "net"
    FROM "payment_methods" m
    LEFT JOIN p ON p."method_id" = m."id"
    LEFT JOIN r ON r."method_id" = m."id"
    WHERE m."property_id" = ${propertyId}::uuid AND (p."method_id" IS NOT NULL OR r."method_id" IS NOT NULL)
    ORDER BY m."code"`;
}

/** Every void and refund in the range. */
export function findVoidsAndRefunds(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      business_date: string;
      kind: string;
      receipt_number: string;
      method: string;
      amount: string;
      reason: string | null;
      user_name: string | null;
    }[]
  >`
    SELECT p."business_date"::text AS "business_date", 'VOID' AS "kind", p."receipt_number",
           m."name" AS "method", p."amount"::text AS "amount", rc."name" AS "reason",
           (SELECT u."display_name"
              FROM "folio_items" line
              JOIN "folio_items" rev ON rev."corrects_item_id" = line."id" AND rev."kind" = 'REVERSAL'
              JOIN "users" u ON u."id" = rev."posted_by_id"
             WHERE line."payment_id" = p."id" AND line."kind" = 'PAYMENT' AND line."refund_id" IS NULL
             LIMIT 1) AS "user_name"
    FROM "payments" p
    JOIN "payment_methods" m ON m."id" = p."method_id"
    LEFT JOIN "reason_codes" rc ON rc."id" = p."void_reason_id"
    WHERE p."property_id" = ${propertyId}::uuid AND p."status" = 'VOIDED'
      AND p."business_date" BETWEEN ${from}::date AND ${to}::date
    UNION ALL
    SELECT f."business_date"::text, 'REFUND', p."receipt_number", m."name", f."amount"::text,
           rc."name", u."display_name"
    FROM "refunds" f
    JOIN "payments" p ON p."id" = f."payment_id"
    JOIN "payment_methods" m ON m."id" = p."method_id"
    LEFT JOIN "reason_codes" rc ON rc."id" = f."reason_code_id"
    LEFT JOIN "users" u ON u."id" = f."created_by_id"
    WHERE f."property_id" = ${propertyId}::uuid AND f."status" = 'SUCCEEDED'
      AND f."business_date" BETWEEN ${from}::date AND ${to}::date
    ORDER BY 1, 3`;
}

/** Prior-day corrections (ADJUSTMENT rows, D9) with their reason and user. */
export function findAdjustments(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      business_date: string;
      code: string;
      description: string;
      amount: string;
      reason: string | null;
      comment: string | null;
      user_name: string | null;
      original_date: string | null;
      confirmation: string | null;
    }[]
  >`
    SELECT i."business_date"::text AS "business_date", tc."code", i."description",
           i."amount"::text AS "amount", rc."name" AS "reason", i."comment",
           u."display_name" AS "user_name", o."business_date"::text AS "original_date",
           res."confirmation_number" AS "confirmation"
    FROM "folio_items" i
    JOIN "transaction_codes" tc ON tc."id" = i."transaction_code_id"
    LEFT JOIN "reason_codes" rc ON rc."id" = i."reason_code_id"
    LEFT JOIN "users" u ON u."id" = i."posted_by_id"
    LEFT JOIN "folio_items" o ON o."id" = i."corrects_item_id"
    LEFT JOIN "reservation_rooms" rr ON rr."id" = i."origin_reservation_room_id"
    LEFT JOIN "reservations" res ON res."id" = rr."reservation_id"
    WHERE i."property_id" = ${propertyId}::uuid AND i."kind" = 'ADJUSTMENT'
      AND i."business_date" BETWEEN ${from}::date AND ${to}::date
    ORDER BY i."business_date", i."posted_at"`;
}

/** Open balances as of the end of a business date (ledger lines up to that date). */
export function findBalancesAsOf(db: Tx, propertyId: string, asOf: string) {
  return db.$queryRaw<
    {
      folio_id: string;
      reservation_room_id: string | null;
      window: number;
      guest_name: string | null;
      confirmation: string | null;
      line_number: number | null;
      status: string | null;
      balance: string;
    }[]
  >`
    SELECT f."id" AS "folio_id", f."reservation_room_id", f."window",
           concat_ws(' ', g."first_name", g."last_name") AS "guest_name",
           res."confirmation_number" AS "confirmation", rr."line_number",
           rr."status"::text AS "status", sum(i."amount")::text AS "balance"
    FROM "folios" f
    JOIN "folio_items" i ON i."folio_id" = f."id" AND i."business_date" <= ${asOf}::date
    LEFT JOIN "guests" g ON g."id" = f."payee_guest_id"
    LEFT JOIN "reservation_rooms" rr ON rr."id" = f."reservation_room_id"
    LEFT JOIN "reservations" res ON res."id" = rr."reservation_id"
    WHERE f."property_id" = ${propertyId}::uuid
    GROUP BY f."id", g."first_name", g."last_name", res."confirmation_number", rr."line_number", rr."status"
    HAVING sum(i."amount") <> 0
    ORDER BY sum(i."amount") DESC, f."id"`;
}

/** Guest-ledger roll-forward per business date, straight from the ledger. */
export function findLedgerMovement(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      business_date: string;
      opening: string;
      charges: string;
      payments: string;
      corrections: string;
      closing: string;
    }[]
  >`
    WITH days AS (
      SELECT d::date AS "business_date"
      FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d
    ),
    moves AS (
      SELECT i."business_date",
             COALESCE(sum(i."amount") FILTER (WHERE i."kind" IN ('CHARGE', 'TAX')), 0) AS "charges",
             COALESCE(sum(i."amount") FILTER (WHERE i."kind" = 'PAYMENT'), 0) AS "payments",
             COALESCE(sum(i."amount") FILTER (WHERE i."kind" NOT IN ('CHARGE', 'TAX', 'PAYMENT')), 0) AS "corrections"
      FROM "folio_items" i
      WHERE i."property_id" = ${propertyId}::uuid
        AND i."business_date" BETWEEN ${from}::date AND ${to}::date
      GROUP BY i."business_date"
    ),
    opening AS (
      SELECT COALESCE(sum("amount"), 0) AS "amount" FROM "folio_items"
      WHERE "property_id" = ${propertyId}::uuid AND "business_date" < ${from}::date
    )
    SELECT days."business_date"::text AS "business_date",
           ((SELECT "amount" FROM opening) + COALESCE(sum(COALESCE(m."charges", 0) + COALESCE(m."payments", 0) + COALESCE(m."corrections", 0))
              OVER (ORDER BY days."business_date" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))::text AS "opening",
           COALESCE(m."charges", 0)::text AS "charges",
           COALESCE(m."payments", 0)::text AS "payments",
           COALESCE(m."corrections", 0)::text AS "corrections",
           ((SELECT "amount" FROM opening) + sum(COALESCE(m."charges", 0) + COALESCE(m."payments", 0) + COALESCE(m."corrections", 0))
              OVER (ORDER BY days."business_date" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::text AS "closing"
    FROM days
    LEFT JOIN moves m ON m."business_date" = days."business_date"
    ORDER BY days."business_date"`;
}

/**
 * Room revenue (room lines net of their corrections) and room nights by a
 * dimension: the night's rate plan, the reservation's company or group.
 */
export function sumRoomProduction(
  db: Tx,
  { propertyId, from, to }: Range,
  by: "rate_plan" | "company" | "group",
) {
  const dimension = {
    rate_plan: `rp."code" AS "key", rp."name" AS "name"`,
    company: `COALESCE(co."name", '(no company)') AS "key", co."name" AS "name"`,
    group: `COALESCE(gr."code", '(no group)') AS "key", gr."name" AS "name"`,
  }[by];
  return db.$queryRawUnsafe<
    { key: string; name: string | null; nights: number; revenue: string }[]
  >(
    `WITH room_lines AS (
       SELECT i."id", i."origin_reservation_room_id", i."revenue_date",
              i."amount" + COALESCE((SELECT sum(c."amount") FROM "folio_items" c
                                     WHERE c."corrects_item_id" = i."id"), 0) AS "net"
       FROM "folio_items" i
       WHERE i."property_id" = $1::uuid AND i."kind" = 'CHARGE'
         AND i."posting_key" LIKE 'ROOM:%'
         AND i."revenue_date" BETWEEN $2::date AND $3::date
     )
     SELECT ${dimension},
            count(*) FILTER (WHERE l."net" <> 0)::int AS "nights",
            COALESCE(sum(l."net"), 0)::text AS "revenue"
     FROM room_lines l
     JOIN "reservation_rooms" rr ON rr."id" = l."origin_reservation_room_id"
     JOIN "reservations" res ON res."id" = rr."reservation_id"
     LEFT JOIN "reservation_room_nights" n
       ON n."reservation_room_id" = rr."id" AND n."stay_date" = l."revenue_date"
     LEFT JOIN "rate_plans" rp ON rp."id" = COALESCE(n."rate_plan_id", rr."rate_plan_id")
     LEFT JOIN "account_profiles" co ON co."id" = res."company_id"
     LEFT JOIN "groups" gr ON gr."id" = res."group_id"
     GROUP BY 1, 2
     ORDER BY sum(l."net") DESC, 1`,
    propertyId,
    from,
    to,
  );
}

/** Package lines by package and component, net of their corrections. */
export function sumPackageRevenue(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      package: string;
      component: string;
      code: string;
      lines: number;
      quantity: string;
      revenue: string;
    }[]
  >`
    SELECT p."code" AS "package", pc."name" AS "component", tc."code",
           count(*)::int AS "lines", sum(i."quantity")::text AS "quantity",
           COALESCE(sum(i."amount" + COALESCE((SELECT sum(c."amount") FROM "folio_items" c
                                               WHERE c."corrects_item_id" = i."id"), 0)), 0)::text AS "revenue"
    FROM "folio_items" i
    JOIN "package_components" pc ON pc."id" = i."package_component_id"
    JOIN "packages" p ON p."id" = pc."package_id"
    JOIN "transaction_codes" tc ON tc."id" = i."transaction_code_id"
    WHERE i."property_id" = ${propertyId}::uuid AND i."kind" = 'CHARGE'
      AND i."business_date" BETWEEN ${from}::date AND ${to}::date
    GROUP BY p."code", pc."name", tc."code"
    ORDER BY p."code", pc."name"`;
}

// --- Audit ---------------------------------------------------------------------------------------

export function findAuditRuns(db: Tx, { propertyId, from, to }: Range) {
  return db.$queryRaw<
    {
      business_date: string;
      attempt: number;
      status: string;
      started_at: Date;
      finished_at: Date | null;
      user_name: string | null;
      error_code: string | null;
      summary: unknown;
    }[]
  >`
    SELECT r."business_date"::text AS "business_date", r."attempt", r."status"::text AS "status",
           r."started_at", r."finished_at", u."display_name" AS "user_name", r."error_code", r."summary"
    FROM "night_audit_runs" r
    LEFT JOIN "users" u ON u."id" = r."started_by_id"
    WHERE r."property_id" = ${propertyId}::uuid
      AND r."business_date" BETWEEN ${from}::date AND ${to}::date
    ORDER BY r."business_date" DESC, r."attempt" DESC`;
}

export const AUDIT_TRAIL_LIMIT = 2000;

export function findAuditTrail(db: Tx, range: Range, risk: string | null) {
  return db.$queryRaw<
    {
      created_at: Date;
      business_date: string | null;
      action: string;
      resource_type: string;
      risk: string;
      user_name: string | null;
      actor_type: string;
      reason: string | null;
    }[]
  >`
    SELECT a."created_at", a."business_date"::text AS "business_date", a."action",
           a."resource_type", a."risk"::text AS "risk", u."display_name" AS "user_name",
           a."actor_type", a."reason"
    FROM "audit_logs" a
    LEFT JOIN "users" u ON u."id" = a."user_id"
    WHERE a."property_id" = ${range.propertyId}::uuid
      AND a."business_date" BETWEEN ${range.from}::date AND ${range.to}::date
      AND (${risk}::text IS NULL OR a."risk"::text = ${risk}::text)
    ORDER BY a."created_at" DESC
    LIMIT ${AUDIT_TRAIL_LIMIT}`;
}

// --- Dashboard --------------------------------------------------------------------------------

export async function sumOpenBalances(db: Tx, propertyId: string) {
  const rows = await db.$queryRaw<{ balance: string; folios: number }[]>`
    SELECT COALESCE(sum("balance"), 0)::text AS "balance", count(*)::int AS "folios"
    FROM "folios"
    WHERE "property_id" = ${propertyId}::uuid AND "balance" <> 0`;
  return rows[0]!;
}

export async function countTodayMovements(db: Tx, propertyId: string, businessDate: string) {
  const rows = await db.$queryRaw<
    {
      arrivals_expected: number;
      arrivals_done: number;
      departures_expected: number;
      departures_done: number;
      in_house: number;
      vip_arrivals: number;
    }[]
  >`
    SELECT
      (SELECT count(*) FROM "reservation_rooms" WHERE "property_id" = ${propertyId}::uuid
         AND "status" = 'RESERVED' AND "arrival_date" = ${businessDate}::date)::int AS "arrivals_expected",
      (SELECT count(*) FROM "stays" WHERE "property_id" = ${propertyId}::uuid
         AND "arrival_business_date" = ${businessDate}::date)::int AS "arrivals_done",
      (SELECT count(*) FROM "reservation_rooms" WHERE "property_id" = ${propertyId}::uuid
         AND "status" = 'IN_HOUSE' AND "departure_date" <= ${businessDate}::date)::int AS "departures_expected",
      (SELECT count(*) FROM "stays" WHERE "property_id" = ${propertyId}::uuid
         AND "departure_business_date" = ${businessDate}::date)::int AS "departures_done",
      (SELECT count(*) FROM "reservation_rooms" WHERE "property_id" = ${propertyId}::uuid
         AND "status" = 'IN_HOUSE')::int AS "in_house",
      (SELECT count(*) FROM "reservation_rooms" rr JOIN "guests" g ON g."id" = rr."primary_guest_id"
         WHERE rr."property_id" = ${propertyId}::uuid AND rr."status" = 'RESERVED'
           AND rr."arrival_date" = ${businessDate}::date AND g."vip_level_id" IS NOT NULL)::int AS "vip_arrivals"`;
  return rows[0]!;
}

export async function countRoomStates(db: Tx, propertyId: string) {
  const rows = await db.$queryRaw<
    {
      dirty: number;
      clean: number;
      inspected: number;
      out_of_order: number;
      out_of_service: number;
      vacant: number;
      occupied: number;
    }[]
  >`
    SELECT count(*) FILTER (WHERE r."housekeeping_status" = 'DIRTY')::int AS "dirty",
           count(*) FILTER (WHERE r."housekeeping_status" = 'CLEAN')::int AS "clean",
           count(*) FILTER (WHERE r."housekeeping_status" = 'INSPECTED')::int AS "inspected",
           count(*) FILTER (WHERE r."service_status" = 'OUT_OF_ORDER')::int AS "out_of_order",
           count(*) FILTER (WHERE r."service_status" = 'OUT_OF_SERVICE')::int AS "out_of_service",
           count(*) FILTER (WHERE r."front_office_status" = 'VACANT')::int AS "vacant",
           count(*) FILTER (WHERE r."front_office_status" = 'OCCUPIED')::int AS "occupied"
    FROM "rooms" r
    JOIN "room_types" rt ON rt."id" = r."room_type_id"
    WHERE r."property_id" = ${propertyId}::uuid AND r."status" = 'ACTIVE' AND NOT rt."is_pseudo"`;
  return rows[0]!;
}
