import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db/prisma";
import { findUnbalancedFolios } from "@/modules/night-audit/night-audit.repository";
import { createMigratedDatabase, sqlStateOf, withoutReferentialChecks } from "../support/pglite";

/**
 * The night-audit balance check (scalability phase 6B, docs/SCALABILITY.md §34).
 * `findUnbalancedFolios` was rewritten from one correlated ledger sum per
 * folio into one aggregate. This file runs the production statement against
 * the previous one (the oracle below, verbatim) on the same rows: handcrafted
 * edge cases and seeded random ledgers whose stored totals drift from their
 * lines. Drift is impossible through the application (the ledger trigger keeps
 * the totals and a check ties them together), so the fixtures are written with
 * triggers off and that check dropped — in this throwaway database only.
 */

const ORG = "00000000-0000-7000-8000-000000000001";
const ORG2 = "00000000-0000-7000-8000-000000000002";
const P1 = "00000000-0000-7000-8000-0000000000a1";
const P2 = "00000000-0000-7000-8000-0000000000a2";
const P3 = "00000000-0000-7000-8000-0000000000a3"; // another organization
const USER = "00000000-0000-7000-8000-0000000000e9";
const D = "2026-03-10";
const DATES = ["2026-03-08", "2026-03-09", D, "2026-03-11", "2026-01-01"];

/** The statement as it was before phase 6B (oracle). */
const REFERENCE_SQL = `
    WITH candidates AS (
      SELECT f."id", f."reservation_room_id", f."window", f."balance", f."charges_total",
             f."credits_total"
      FROM "folios" f
      WHERE f."property_id" = $1::uuid
        AND (f."status" <> 'CLOSED'
             OR EXISTS (SELECT 1 FROM "folio_items" d
                        WHERE d."folio_id" = f."id" AND d."property_id" = $1::uuid
                          AND d."business_date" = $2::date))
    ), checked AS (
      SELECT c.*,
             COALESCE((SELECT sum(i."amount") FROM "folio_items" i WHERE i."folio_id" = c."id"), 0)
               AS "ledger"
      FROM candidates c
    )
    SELECT "id", "reservation_room_id", "window", "balance"::text AS "balance",
           "ledger"::text AS "ledger"
    FROM checked
    WHERE "balance" <> "ledger" OR "balance" <> "charges_total" + "credits_total"
    ORDER BY "id"`;

type Row = {
  id: string;
  reservation_room_id: string | null;
  window: number;
  balance: string;
  ledger: string;
};

let db: PGlite;

/** Runs the production statement: the repository's own SQL, captured, on PGlite. */
async function production(propertyId: string, businessDate: string): Promise<Row[]> {
  let captured: { sql: string; values: unknown[] } | null = null;
  const capture = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured = {
        sql: strings.reduce((sql, part, i) => `${sql}$${i}${part}`),
        values,
      };
      return Promise.resolve([]);
    },
  } as unknown as Tx;
  await findUnbalancedFolios(capture, propertyId, businessDate);
  const { sql, values } = captured!;
  return (await db.query<Row>(sql, values)).rows;
}

async function reference(propertyId: string, businessDate: string): Promise<Row[]> {
  return (await db.query<Row>(REFERENCE_SQL, [propertyId, businessDate])).rows;
}

// --- Fixtures --------------------------------------------------------------------------------

let seq = 0;
const uuid = (prefix: string) =>
  `${prefix}${(++seq).toString(16).padStart(24, "0")}`.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5",
  );

interface FolioSpec {
  property: string;
  status?: "OPEN" | "SETTLED" | "CLOSED";
  currency?: string;
  owner?: "GUEST" | "ACCOUNT";
  window?: number;
  /** [business date, signed amount] */
  lines?: [string, string][];
  /** Stored totals; default: consistent with the lines. */
  charges?: string;
  credits?: string;
  balance?: string;
}

function folioSql(id: string, spec: FolioSpec): string {
  const lines = spec.lines ?? [];
  const sum = (filter: (n: number) => boolean) =>
    lines
      .map(([, a]) => a)
      .filter((a) => filter(Number(a)))
      .reduce((t, a) => t + BigInt(Math.round(Number(a) * 10_000)), 0n);
  const fmt = (units: bigint) => {
    const sign = units < 0n ? "-" : "";
    const abs = units < 0n ? -units : units;
    return `${sign}${abs / 10_000n}.${(abs % 10_000n).toString().padStart(4, "0")}`;
  };
  const charges = spec.charges ?? fmt(sum((n) => n >= 0));
  const credits = spec.credits ?? fmt(sum((n) => n < 0));
  const balance = spec.balance ?? fmt(sum((n) => n >= 0) + sum((n) => n < 0));
  const status = spec.status ?? "OPEN";
  const owner = spec.owner ?? "GUEST";
  const currency = spec.currency ?? "PKR";
  const folio = `INSERT INTO folios (id, property_id, owner_type, reservation_room_id, "window", status,
      currency_code, charges_total, credits_total, balance, opened_by_id, settled_at, settled_by_id,
      closed_at, updated_at)
    VALUES ('${id}', '${spec.property}', '${owner}',
      ${owner === "GUEST" ? `'${uuid("cccccccc")}'` : "NULL"}, ${spec.window ?? 1}, '${status}',
      '${currency}', ${charges}, ${credits}, ${balance}, '${USER}',
      ${status === "SETTLED" ? "now()" : "NULL"}, ${status === "SETTLED" ? `'${USER}'` : "NULL"},
      ${status === "CLOSED" ? "now()" : "NULL"}, now());`;
  const items = lines.map(([date, amount]) => {
    const negative = amount.startsWith("-");
    return `INSERT INTO folio_items (id, property_id, folio_id, kind, source, transaction_code_id,
        business_date, unit_amount, amount, currency_code, description, payment_id)
      VALUES ('${uuid("dddddddd")}', '${spec.property}', '${id}',
        '${negative ? "PAYMENT" : "CHARGE"}', 'MANUAL', '${uuid("eeeeeeee")}', '${date}',
        ${negative ? amount.slice(1) : amount}, ${amount}, '${currency}', 'fixture',
        ${negative ? `'${uuid("ffffffff")}'` : "NULL"});`;
  });
  return [folio, ...items].join("\n");
}

async function addFolio(spec: FolioSpec): Promise<string> {
  const id = uuid("aaaaaaaa");
  await withoutReferentialChecks(db, folioSql(id, spec));
  return id;
}

/** Deterministic PRNG (mulberry32), so a failure reproduces. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeAll(async () => {
  db = await createMigratedDatabase();
  await db.exec(`
    INSERT INTO organizations (id, code, name, base_currency, updated_at) VALUES
      ('${ORG}', 'ORG', 'Org', 'PKR', now()), ('${ORG2}', 'ORG2', 'Org 2', 'AED', now());
    INSERT INTO properties (id, organization_id, code, confirmation_prefix, name, timezone, currency_code, country_code, updated_at) VALUES
      ('${P1}', '${ORG}', 'P1', 'P1', 'Property 1', 'Asia/Karachi', 'PKR', 'PK', now()),
      ('${P2}', '${ORG}', 'P2', 'P2', 'Property 2', 'Asia/Karachi', 'PKR', 'PK', now()),
      ('${P3}', '${ORG2}', 'P3', 'P3', 'Property 3', 'Asia/Dubai', 'AED', 'AE', now());
    -- Lets fixtures store totals that disagree with each other (never possible in production).
    ALTER TABLE folios DROP CONSTRAINT folios_balance_chk;
  `);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("night-audit balance check: edge cases", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const day = (amount: string, date = D): [string, string] => [date, amount];
    const specs: Record<string, FolioSpec> = {
      openDrift: { property: P1, lines: [day("10.0000")], balance: "0", charges: "0" },
      settledDrift: {
        property: P1,
        status: "SETTLED",
        lines: [day("50.0000"), day("-50.0000"), day("5.0000", "2026-03-09")],
        balance: "0",
        charges: "50",
        credits: "-50",
      },
      closedDriftToday: {
        property: P1,
        status: "CLOSED",
        lines: [day("20.0000"), day("1.0000", "2026-03-01")],
        balance: "20",
        charges: "20",
      },
      closedDriftEarlier: {
        property: P1,
        status: "CLOSED",
        lines: [day("20.0000", "2026-03-09")],
        balance: "0",
        charges: "0",
      },
      closedDriftNoLines: { property: P1, status: "CLOSED", balance: "3", charges: "3" },
      openNoLinesNonZero: { property: P1, balance: "7.5000", charges: "7.5000" },
      openNoLinesZero: { property: P1 },
      partiallyPaid: { property: P1, lines: [day("100.0000"), day("-40.0000")] },
      partiallyPaidDrift: {
        property: P1,
        lines: [day("100.0000"), day("-40.0000")],
        balance: "60.0001",
        charges: "100.0001",
      },
      settledBalanced: {
        property: P1,
        status: "SETTLED",
        lines: [day("12.3456", "2026-02-01"), day("-12.3456")],
      },
      foreignCurrencyDrift: {
        property: P1,
        currency: "USD",
        lines: [day("0.0001"), day("99999999.9999", "2026-03-11")],
        balance: "99999999.9999",
        charges: "99999999.9999",
      },
      creditDrift: {
        property: P1,
        lines: [day("-250.0000")],
        balance: "-249.9999",
        credits: "-249.9999",
        charges: "0",
      },
      totalsDisagree: {
        property: P1,
        lines: [day("30.0000")],
        balance: "30.0000",
        charges: "31.0000",
        credits: "0",
      },
      accountFolioDrift: {
        property: P1,
        owner: "ACCOUNT",
        window: 2,
        lines: [day("1.0000")],
        balance: "2",
        charges: "2",
      },
      otherPropertyDrift: { property: P2, lines: [day("10.0000")], balance: "0", charges: "0" },
      otherOrganizationDrift: {
        property: P3,
        lines: [day("10.0000")],
        balance: "0",
        charges: "0",
      },
    };
    for (const [name, spec] of Object.entries(specs)) ids[name] = await addFolio(spec);
  });

  it("finds exactly the drifted folios the rule names, with the same values", async () => {
    const rows = await production(P1, D);
    expect(rows).toEqual(await reference(P1, D));
    const byName = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [id, name]),
    ) as Record<string, string>;
    expect(rows.map((r) => byName[r.id]).sort()).toEqual(
      [
        "accountFolioDrift",
        "closedDriftToday",
        "creditDrift",
        "foreignCurrencyDrift",
        "openDrift",
        "openNoLinesNonZero",
        "partiallyPaidDrift",
        "settledDrift",
        "totalsDisagree",
      ].sort(),
    );
    const row = (name: string) => rows.find((r) => r.id === ids[name])!;
    // No lines: ledger 0, as before. Exact decimal text, no rounding.
    expect(row("openNoLinesNonZero")).toMatchObject({ balance: "7.5000", ledger: "0" });
    expect(row("settledDrift")).toMatchObject({ balance: "0.0000", ledger: "5.0000" });
    expect(row("foreignCurrencyDrift").ledger).toBe("100000000.0000");
    expect(row("creditDrift")).toMatchObject({ balance: "-249.9999", ledger: "-250.0000" });
    expect(row("accountFolioDrift")).toMatchObject({ reservation_room_id: null, window: 2 });
  });

  it("never returns another property's or organization's folio", async () => {
    for (const property of [P1, P2, P3]) {
      for (const date of DATES) {
        const rows = await production(property, date);
        expect(rows).toEqual(await reference(property, date));
        const owners = await db.query<{ property_id: string }>(
          `SELECT DISTINCT property_id FROM folios WHERE id = ANY($1::uuid[])`,
          [rows.map((r) => r.id)],
        );
        expect(owners.rows.every((o) => o.property_id === property)).toBe(true);
      }
    }
    expect((await production(P2, D)).map((r) => r.id)).toEqual([ids.otherPropertyDrift]);
    expect((await production(P3, D)).map((r) => r.id)).toEqual([ids.otherOrganizationDrift]);
  });

  it("cannot count another property's line: lines reference (property, folio)", async () => {
    // User triggers off (they would refuse it first for other reasons); the
    // foreign key itself stays enforced.
    await db.exec("ALTER TABLE folio_items DISABLE TRIGGER USER");
    const state = await sqlStateOf(() =>
      db.exec(`
        INSERT INTO folio_items (id, property_id, folio_id, kind, source, transaction_code_id,
          business_date, unit_amount, amount, currency_code, description)
        VALUES (gen_random_uuid(), '${P2}', '${ids.openDrift}', 'CHARGE', 'MANUAL',
          gen_random_uuid(), '${D}', 1, 1, 'PKR', 'cross-property')`),
    );
    await db.exec("ALTER TABLE folio_items ENABLE TRIGGER USER");
    expect(state).toBe("23503");
  });
});

describe("night-audit balance check: random ledgers", () => {
  it("matches the previous statement on 1,200 random folios, every property and date", async () => {
    const random = prng(20261001);
    const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
    const amount = (sign: 1 | -1) => {
      const units = 1 + Math.floor(random() * 50_000_000);
      const text = `${Math.floor(units / 10_000)}.${(units % 10_000).toString().padStart(4, "0")}`;
      return sign < 0 ? `-${text}` : text;
    };
    let drifted = 0;
    for (let n = 0; n < 1_200; n++) {
      const lines: [string, string][] = Array.from({ length: Math.floor(random() * 7) }, () => [
        pick(DATES.slice(0, 4)),
        amount(random() < 0.3 ? -1 : 1),
      ]);
      const spec: FolioSpec = {
        property: pick([P1, P1, P2, P3]),
        status: pick(["OPEN", "SETTLED", "CLOSED"] as const),
        currency: pick(["PKR", "USD", "AED"]),
        owner: pick(["GUEST", "ACCOUNT"] as const),
        window: 1 + Math.floor(random() * 3),
        lines,
      };
      const kind = random();
      if (kind < 0.15) {
        // Stored balance and charges off by a random amount (the ledger disagrees).
        const delta = amount(random() < 0.5 ? -1 : 1);
        spec.balance = delta;
        spec.charges = delta;
        spec.credits = "0";
        drifted += 1;
      } else if (kind < 0.2) {
        // Off by the smallest unit.
        spec.balance = "0.0001";
        spec.charges = "0.0001";
        spec.credits = "0";
        drifted += 1;
      } else if (kind < 0.25) {
        // Totals that disagree with the balance.
        spec.charges = "1.0000";
        spec.credits = "0";
        drifted += 1;
      }
      await addFolio(spec);
    }
    expect(drifted).toBeGreaterThan(200);
    let found = 0;
    for (const property of [P1, P2, P3]) {
      for (const date of DATES) {
        const rows = await production(property, date);
        expect(rows).toEqual(await reference(property, date));
        found += rows.length;
      }
    }
    // The comparison is meaningful: plenty of folios are reported.
    expect(found).toBeGreaterThan(500);
  }, 120_000);
});
