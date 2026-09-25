import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, sqlStateOf, withoutReferentialChecks } from "../support/pglite";

// Reservation-related database guarantees (docs/DATABASE_DESIGN.md §5).

const ORG = "00000000-0000-7000-8000-000000000001";
const P1 = "00000000-0000-7000-8000-0000000000a1";
const P2 = "00000000-0000-7000-8000-0000000000a2";
const RT_P1 = "00000000-0000-7000-8000-0000000000b1";
const RT_P2 = "00000000-0000-7000-8000-0000000000b2";

let db: PGlite;

const reservation = (id: string, propertyId: string, confirmation: string) => `
  INSERT INTO reservations (id, property_id, confirmation_number, source_code_id, market_code_id, booked_by_id, updated_at)
  VALUES ('${id}', '${propertyId}', '${confirmation}', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now())`;

const reservationRoom = (id: string, extra: Record<string, string> = {}) => {
  const columns = {
    id: `'${id}'`,
    property_id: `'${P1}'`,
    reservation_id: "gen_random_uuid()",
    line_number: "1",
    status: "'RESERVED'",
    primary_guest_id: "gen_random_uuid()",
    arrival_date: "'2026-10-10'",
    departure_date: "'2026-10-12'",
    room_type_id: `'${RT_P1}'`,
    rate_room_type_id: `'${RT_P1}'`,
    rate_plan_id: "gen_random_uuid()",
    currency_code: "'PKR'",
    reservation_type_id: "gen_random_uuid()",
    market_code_id: "gen_random_uuid()",
    source_code_id: "gen_random_uuid()",
    updated_at: "now()",
    ...extra,
  };
  return `INSERT INTO reservation_rooms (${Object.keys(columns).join(", ")}) VALUES (${Object.values(columns).join(", ")})`;
};

beforeAll(async () => {
  db = await createMigratedDatabase();
  await db.exec(`
    INSERT INTO organizations (id, code, name, base_currency, updated_at) VALUES ('${ORG}', 'ORG', 'Org', 'PKR', now());
    INSERT INTO properties (id, organization_id, code, name, timezone, currency_code, country_code, updated_at) VALUES
      ('${P1}', '${ORG}', 'P1', 'Property 1', 'Asia/Karachi', 'PKR', 'PK', now()),
      ('${P2}', '${ORG}', 'P2', 'Property 2', 'Asia/Dubai', 'AED', 'AE', now());
    INSERT INTO room_types (id, property_id, code, name, max_occupancy, max_adults, updated_at) VALUES
      ('${RT_P1}', '${P1}', 'DLX', 'Deluxe', 3, 3, now()),
      ('${RT_P2}', '${P2}', 'DLX', 'Deluxe', 3, 3, now());
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("confirmation numbers", () => {
  it("are unique within a property but may repeat across properties", async () => {
    await withoutReferentialChecks(
      db,
      reservation("00000000-0000-7000-8000-00000000c001", P1, "100001"),
    );
    expect(
      await sqlStateOf(() =>
        withoutReferentialChecks(
          db,
          reservation("00000000-0000-7000-8000-00000000c002", P1, "100001"),
        ),
      ),
    ).toBe("23505");
    expect(
      await sqlStateOf(() =>
        withoutReferentialChecks(
          db,
          reservation("00000000-0000-7000-8000-00000000c003", P2, "100001"),
        ),
      ),
    ).toBeUndefined();
  });

  it("gap-free counters are one row per property and name", async () => {
    await db.exec(
      `INSERT INTO property_sequences (property_id, name, next_value, updated_at) VALUES ('${P1}', 'confirmation', 100000, now())`,
    );
    expect(
      await sqlStateOf(() =>
        db.exec(
          `INSERT INTO property_sequences (property_id, name, next_value, updated_at) VALUES ('${P1}', 'confirmation', 1, now())`,
        ),
      ),
    ).toBe("23505");
  });
});

describe("inventory counters", () => {
  it("cannot reference another property's room type", async () => {
    expect(
      await sqlStateOf(() =>
        db.exec(`INSERT INTO room_type_inventory (property_id, room_type_id, stay_date, physical_rooms, updated_at)
                 VALUES ('${P1}', '${RT_P2}', '2026-10-10', 5, now())`),
      ),
    ).toBe("23503");
  });

  it("cannot go negative and has one row per room type and night", async () => {
    await db.exec(`INSERT INTO room_type_inventory (property_id, room_type_id, stay_date, physical_rooms, updated_at)
                   VALUES ('${P1}', '${RT_P1}', '2026-10-10', 5, now())`);
    expect(
      await sqlStateOf(() =>
        db.exec(`UPDATE room_type_inventory SET sold = -1 WHERE room_type_id = '${RT_P1}'`),
      ),
    ).toBe("23514");
    expect(
      await sqlStateOf(() =>
        db.exec(`INSERT INTO room_type_inventory (property_id, room_type_id, stay_date, physical_rooms, updated_at)
                 VALUES ('${P1}', '${RT_P1}', '2026-10-10', 5, now())`),
      ),
    ).toBe("23505");
  });
});

describe("reservation rooms", () => {
  it("store one night row per stay date", async () => {
    const rr = "00000000-0000-7000-8000-00000000d001";
    await withoutReferentialChecks(db, reservationRoom(rr));
    const night = `INSERT INTO reservation_room_nights (property_id, reservation_room_id, stay_date, room_type_id, rate_plan_id, rate_amount, currency_code, adults)
                   VALUES ('${P1}', '${rr}', '2026-10-10', '${RT_P1}', gen_random_uuid(), 18500, 'PKR', 2)`;
    await withoutReferentialChecks(db, night);
    expect(await sqlStateOf(() => withoutReferentialChecks(db, night))).toBe("23505");
  });

  it("keep cancellation and no-show fields consistent with the status", async () => {
    expect(
      await sqlStateOf(() =>
        withoutReferentialChecks(
          db,
          reservationRoom("00000000-0000-7000-8000-00000000d002", { status: "'CANCELLED'" }),
        ),
      ),
    ).toBe("23514");
    expect(
      await sqlStateOf(() =>
        withoutReferentialChecks(
          db,
          reservationRoom("00000000-0000-7000-8000-00000000d003", {
            status: "'CANCELLED'",
            cancelled_at: "now()",
            cancellation_business_date: "'2026-09-24'",
          }),
        ),
      ),
    ).toBeUndefined();
    expect(
      await sqlStateOf(() =>
        withoutReferentialChecks(
          db,
          reservationRoom("00000000-0000-7000-8000-00000000d004", { status: "'NO_SHOW'" }),
        ),
      ),
    ).toBe("23514");
    // Phase 8: the business date of the cancellation is required exactly while cancelled.
    expect(
      await sqlStateOf(() =>
        withoutReferentialChecks(
          db,
          reservationRoom("00000000-0000-7000-8000-00000000d005", {
            status: "'CANCELLED'",
            cancelled_at: "now()",
          }),
        ),
      ),
    ).toBe("23514");
    expect(
      await sqlStateOf(() =>
        withoutReferentialChecks(
          db,
          reservationRoom("00000000-0000-7000-8000-00000000d006", {
            status: "'RESERVED'",
            cancellation_business_date: "'2026-09-24'",
          }),
        ),
      ),
    ).toBe("23514");
  });

  it("reject a party without adults", async () => {
    expect(
      await sqlStateOf(() =>
        withoutReferentialChecks(
          db,
          reservationRoom("00000000-0000-7000-8000-00000000d005", { adults: "0" }),
        ),
      ),
    ).toBe("23514");
  });
});
