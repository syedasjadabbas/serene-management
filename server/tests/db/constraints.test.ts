import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, sqlStateOf, withoutReferentialChecks } from "../support/pglite";

// Database-level guarantees documented in docs/DATABASE_DESIGN.md §Integrity rules.
// They must hold even if a service has a bug.

const ORG = "00000000-0000-7000-8000-000000000001";
const P1 = "00000000-0000-7000-8000-0000000000a1";
const P2 = "00000000-0000-7000-8000-0000000000a2";
const RT_P1 = "00000000-0000-7000-8000-0000000000b1";
const RT_P2 = "00000000-0000-7000-8000-0000000000b2";
const ROOM = "00000000-0000-7000-8000-0000000000c1";
const USER = "00000000-0000-7000-8000-0000000000e9";

let db: PGlite;

beforeAll(async () => {
  db = await createMigratedDatabase();
  await db.exec(`
    INSERT INTO organizations (id, code, name, base_currency, updated_at)
      VALUES ('${ORG}', 'ORG', 'Org', 'PKR', now());
    INSERT INTO properties (id, organization_id, code, confirmation_prefix, name, timezone, currency_code, country_code, updated_at) VALUES
      ('${P1}', '${ORG}', 'P1', 'P1', 'Property 1', 'Asia/Karachi', 'PKR', 'PK', now()),
      ('${P2}', '${ORG}', 'P2', 'P2', 'Property 2', 'Asia/Karachi', 'PKR', 'PK', now());
    INSERT INTO room_types (id, property_id, code, name, max_occupancy, max_adults, updated_at) VALUES
      ('${RT_P1}', '${P1}', 'DLX', 'Deluxe', 3, 3, now()),
      ('${RT_P2}', '${P2}', 'DLX', 'Deluxe', 3, 3, now());
    INSERT INTO rooms (id, property_id, room_type_id, number, updated_at)
      VALUES ('${ROOM}', '${P1}', '${RT_P1}', '101', now());
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("property isolation", () => {
  it("rejects a room that points at another property's room type", async () => {
    const state = await sqlStateOf(() =>
      db.exec(`
        INSERT INTO rooms (id, property_id, room_type_id, number, updated_at)
        VALUES (gen_random_uuid(), '${P1}', '${RT_P2}', '999', now())`),
    );
    expect(state).toBe("23503");
  });
});

describe("business date", () => {
  it("allows exactly one current business date per property", async () => {
    await db.exec(
      `INSERT INTO business_dates (id, property_id, date) VALUES (gen_random_uuid(), '${P1}', '2026-09-24')`,
    );
    const state = await sqlStateOf(() =>
      db.exec(
        `INSERT INTO business_dates (id, property_id, date) VALUES (gen_random_uuid(), '${P1}', '2026-09-25')`,
      ),
    );
    expect(state).toBe("23505");
  });

  it("freezes closed business dates", async () => {
    await db.exec(
      `UPDATE business_dates SET status = 'CLOSED', is_current = false, closed_at = now() WHERE property_id = '${P1}'`,
    );
    expect(
      await sqlStateOf(() =>
        db.exec(`UPDATE business_dates SET closed_at = now() WHERE property_id = '${P1}'`),
      ),
    ).toBe("SM001");
    expect(
      await sqlStateOf(() => db.exec(`DELETE FROM business_dates WHERE property_id = '${P1}'`)),
    ).toBe("SM001");
  });
});

describe("room assignment conflicts", () => {
  const KEY_A = "00000000-0000-7000-8000-00000000000a";
  const KEY_B = "00000000-0000-7000-8000-00000000000b";
  const KEY_C = "00000000-0000-7000-8000-00000000000c";

  const assign = (from: string, to: string, occupancyKey: string) =>
    withoutReferentialChecks(
      db,
      `INSERT INTO room_assignments
         (id, property_id, reservation_room_id, room_id, from_date, to_date, occupancy_key, assigned_by_id)
       VALUES (gen_random_uuid(), '${P1}', gen_random_uuid(), '${ROOM}', '${from}', '${to}', '${occupancyKey}', '${USER}')`,
    );

  beforeAll(async () => {
    await assign("2026-10-01", "2026-10-04", KEY_A);
  });

  it("rejects an overlapping assignment of the same room", async () => {
    expect(await sqlStateOf(() => assign("2026-10-03", "2026-10-05", KEY_B))).toBe("23P01");
  });

  it("allows back-to-back stays and share-with reservations", async () => {
    expect(await sqlStateOf(() => assign("2026-10-04", "2026-10-06", KEY_B))).toBeUndefined();
    expect(await sqlStateOf(() => assign("2026-10-02", "2026-10-03", KEY_A))).toBeUndefined();
  });

  it("treats day use as occupying its calendar day", async () => {
    expect(await sqlStateOf(() => assign("2026-10-02", "2026-10-02", KEY_C))).toBe("23P01");
  });
});

describe("append-only records", () => {
  it("rejects updates and deletes of audit logs", async () => {
    await db.exec(
      `INSERT INTO audit_logs (id, organization_id, action, resource_type)
       VALUES (gen_random_uuid(), '${ORG}', 'test.action', 'test')`,
    );
    expect(await sqlStateOf(() => db.exec(`UPDATE audit_logs SET action = 'tampered'`))).toBe(
      "SM001",
    );
    expect(await sqlStateOf(() => db.exec(`DELETE FROM audit_logs`))).toBe("SM001");
  });
});

describe("reservation rules", () => {
  it("rejects departure before arrival", async () => {
    const state = await sqlStateOf(() =>
      withoutReferentialChecks(
        db,
        `INSERT INTO reservation_rooms
           (id, property_id, reservation_id, line_number, primary_guest_id, arrival_date, departure_date,
            room_type_id, rate_room_type_id, rate_plan_id, currency_code, reservation_type_id,
            market_code_id, source_code_id, updated_at)
         VALUES (gen_random_uuid(), '${P1}', gen_random_uuid(), 1, gen_random_uuid(), '2026-10-05', '2026-10-04',
            '${RT_P1}', '${RT_P1}', gen_random_uuid(), 'PKR', gen_random_uuid(),
            gen_random_uuid(), gen_random_uuid(), now())`,
      ),
    );
    expect(state).toBe("23514");
  });
});
