/* eslint-disable no-console -- load-test command: prints its result to the terminal */
// Benchmark dataset generator (docs/SCALABILITY.md §Data volume). NON-PRODUCTION ONLY.
//
// Grows a freshly seeded demo database (`npm run db:deploy` + `SEED_DEMO=true npm run
// db:seed` against a database whose name ends in `_bench`) to hotel-chain volume:
// larger properties, an organization-wide guest base, years of checked-out history
// with folios, payments, nights, housekeeping, status history and audit trail, plus
// today's in-house guests and the next weeks' reservations.
//
// Bulk history is written with set-based SQL, one statement per table and property
// (a failed run is not resumable: recreate the database and run again). The integrity triggers that reject
// back-dated postings and maintain folio totals are disabled ONLY for the load and
// the totals are written consistently by this script (the database must be owned by
// the connecting role). Never run against a real database: the name guard refuses.
//
//   DATABASE_URL=postgresql://…/serene_bench node scripts/load/seed-benchmark.mjs
//
// Sizes (per property unless noted), all overridable by environment:
//   BENCH_ROOMS=300            rooms per property
//   BENCH_GUESTS=300000        guest profiles (organization)
//   BENCH_HISTORY=200000       checked-out stays per property
//   BENCH_IN_HOUSE=0.6         share of rooms occupied today
//   BENCH_FUTURE_DAYS=60       days of future reservations
//   BENCH_ARRIVALS=60          future reservations per day
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const database = new URL(url).pathname.slice(1);
if (!/_bench$/.test(database) || process.env.NODE_ENV === "production") {
  throw new Error(
    `Refusing to generate benchmark data in "${database}": the name must end in _bench`,
  );
}

const num = (name, fallback) => Number(process.env[name] ?? fallback);
const ROOMS = num("BENCH_ROOMS", 300);
const GUESTS = num("BENCH_GUESTS", 300_000);
const HISTORY = num("BENCH_HISTORY", 200_000);
const IN_HOUSE = num("BENCH_IN_HOUSE", 0.6);
const FUTURE_DAYS = num("BENCH_FUTURE_DAYS", 60);
const ARRIVALS = num("BENCH_ARRIVALS", 60);

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = (sql, params) => client.query(sql, params);
const started = Date.now();
const log = (message) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${message}`);

const TRIGGERED = ["folio_items", "folios", "payments"];
for (const table of TRIGGERED) await q(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);

try {
  const org = (await q(`SELECT id FROM organizations LIMIT 1`)).rows[0].id;
  const actor = (
    await q(`SELECT id FROM users WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [org])
  ).rows[0].id;

  // --- Guests (organization-wide) -------------------------------------------------
  const existingGuests = Number((await q(`SELECT count(*) FROM guests`)).rows[0].count);
  if (existingGuests < GUESTS) {
    await q(
      `INSERT INTO guests (id, organization_id, profile_number, first_name, last_name, search_name,
                           primary_email, primary_phone, phone_digits, nationality_code, updated_at)
       SELECT gen_random_uuid(), $1, 'B' || lpad(i::text, 8, '0'), f, l, lower(l || ' ' || f),
              CASE WHEN i % 3 = 0 THEN lower(f || '.' || l || i || '@example.test') END,
              CASE WHEN i % 2 = 0 THEN '+9230' || lpad((i % 100000000)::text, 8, '0') END,
              CASE WHEN i % 2 = 0 THEN '9230' || lpad((i % 100000000)::text, 8, '0') END,
              (ARRAY['PK','AE','GB','US','SA','CN','DE','IN'])[1 + i % 8], now()
       FROM generate_series(1, $2::int) AS i,
            LATERAL (SELECT (ARRAY['Ahmed','Fatima','Omar','Aisha','Bilal','Sara','Hamza','Zainab','Ali','Maryam',
                                   'John','Emma','Liam','Olivia','Noah','Ava','Lucas','Mia','Wei','Li',
                                   'Hans','Anna','Raj','Priya','Yusuf','Layla','Ibrahim','Noor','Daniyal','Hina'])[1 + i % 30] AS f,
                            (ARRAY['Khan','Ahmed','Hussain','Malik','Qureshi','Farooq','Shah','Butt','Chaudhry','Siddiqui',
                                   'Smith','Jones','Brown','Taylor','Wilson','Davies','Evans','Thomas','Wang','Zhang',
                                   'Muller','Schmidt','Sharma','Patel','Al Mansouri','Al Nahyan','Haddad','Nasser','Rahman','Iqbal',
                                   'Baig','Mirza','Javed','Anwar','Rashid','Saeed','Tariq','Aslam','Karim','Latif'])[1 + (i / 30) % 40] AS l) n`,
      [org, GUESTS - existingGuests],
    );
    log(`guests: +${GUESTS - existingGuests}`);
  }
  await q(
    `CREATE TEMP TABLE bench_guests AS SELECT row_number() OVER (ORDER BY id) AS gi, id FROM guests`,
  );
  await q(`CREATE INDEX ON bench_guests (gi)`);
  const guestCount = Number((await q(`SELECT count(*) FROM bench_guests`)).rows[0].count);

  const properties = (await q(`SELECT id, code FROM properties ORDER BY code`)).rows;
  for (const property of properties) {
    const p = property.id;
    const bd = (
      await q(`SELECT date::text FROM business_dates WHERE property_id = $1 AND is_current`, [p])
    ).rows[0].date;

    // --- Rooms ----------------------------------------------------------------------
    const roomCount = Number(
      (await q(`SELECT count(*) FROM rooms WHERE property_id = $1`, [p])).rows[0].count,
    );
    if (roomCount < ROOMS) {
      const added = await q(
        `WITH types AS (SELECT room_type_id, row_number() OVER (ORDER BY room_type_id) - 1 AS t, count(*) OVER () AS n
                        FROM rooms WHERE property_id = $1 GROUP BY room_type_id)
         INSERT INTO rooms (id, property_id, room_type_id, number, sort_order, updated_at)
         SELECT gen_random_uuid(), $1, types.room_type_id, (1000 + k)::text, 1000 + k, now()
         FROM generate_series(0, $2::int - 1) AS k JOIN types ON types.t = k % types.n
         RETURNING room_type_id`,
        [p, ROOMS - roomCount],
      );
      const perType = new Map();
      for (const row of added.rows)
        perType.set(row.room_type_id, (perType.get(row.room_type_id) ?? 0) + 1);
      for (const [type, count] of perType) {
        await q(
          `UPDATE room_type_inventory SET physical_rooms = physical_rooms + $3, updated_at = now()
           WHERE property_id = $1 AND room_type_id = $2`,
          [p, type, count],
        );
      }
      log(`${property.code}: rooms +${ROOMS - roomCount}`);
    }

    const template = (
      await q(
        `SELECT rr.rate_plan_id, rr.currency_code, rr.reservation_type_id, rr.market_code_id, rr.source_code_id
         FROM reservation_rooms rr WHERE rr.property_id = $1 LIMIT 1`,
        [p],
      )
    ).rows[0];
    const code = async (sql) => (await q(sql, [p])).rows[0]?.id;
    const roomCode = await code(
      `SELECT id FROM transaction_codes WHERE property_id = $1 AND bucket = 'ROOM' ORDER BY code LIMIT 1`,
    );
    const fbCode = await code(
      `SELECT id FROM transaction_codes WHERE property_id = $1 AND bucket = 'FOOD_BEVERAGE' ORDER BY code LIMIT 1`,
    );
    const payCode = await code(
      `SELECT id FROM transaction_codes WHERE property_id = $1 AND bucket = 'PAYMENT' ORDER BY code LIMIT 1`,
    );
    const method = await code(
      `SELECT id FROM payment_methods WHERE property_id = $1 ORDER BY code LIMIT 1`,
    );
    const taskType = await code(
      `SELECT id FROM housekeeping_task_types WHERE property_id = $1 AND code = 'DEP'`,
    );

    await q(`DROP TABLE IF EXISTS bench_rooms`);
    await q(
      `CREATE TEMP TABLE bench_rooms AS
       SELECT row_number() OVER (ORDER BY number) - 1 AS ri, id, room_type_id, front_office_status::text AS fo
       FROM rooms WHERE property_id = $1`,
      [p],
    );
    const nRooms = Number((await q(`SELECT count(*) FROM bench_rooms`)).rows[0].count);

    // --- Stays: history (checked out), today's in-house, future reservations --------
    // One row per reservation room; kind H = history, I = in house, F = future.
    const conf = await q(
      `UPDATE property_sequences SET next_value = next_value + $2, updated_at = now()
       WHERE property_id = $1 AND name = 'confirmation' RETURNING next_value - $2 AS first`,
      [p, HISTORY + nRooms + FUTURE_DAYS * ARRIVALS],
    );
    const firstConfirmation = Number(conf.rows[0].first);
    const vacant = (await q(`SELECT ri FROM bench_rooms WHERE fo = 'VACANT' ORDER BY ri`)).rows.map(
      (r) => Number(r.ri),
    );
    const inHouseRooms = vacant.slice(0, Math.floor(vacant.length * IN_HOUSE));

    await q(`DROP TABLE IF EXISTS bench_gen`);
    await q(
      `CREATE TEMP TABLE bench_gen AS
       WITH plan AS (
         SELECT 'H' AS kind, i, (i % $2::int) AS ri,
                1 + i % 4 AS nights,
                $1::date - (1 + i % 4) - (i % 1090) - 1 AS arrival
         FROM generate_series(0, $3::int - 1) AS i
         UNION ALL
         SELECT 'I', $3::int + k::int, ri, 1 + k::int % 5, $1::date - (k::int % 3)
         FROM unnest($4::int[]) WITH ORDINALITY AS u(ri, k)
         UNION ALL
         SELECT 'F', $3::int + $2::int + j, NULL, 1 + j % 4, $1::date + 1 + j / $6::int
         FROM generate_series(0, $5::int * $6::int - 1) AS j
       )
       SELECT plan.*, plan.arrival + plan.nights AS departure,
              gen_random_uuid() AS res_id, gen_random_uuid() AS rr_id, gen_random_uuid() AS stay_id,
              gen_random_uuid() AS folio_id, gen_random_uuid() AS pay_id,
              g.id AS guest_id, r.id AS room_id,
              COALESCE(r.room_type_id, (SELECT room_type_id FROM bench_rooms WHERE ri = plan.i % $2::int)) AS room_type_id,
              ($7::bigint + plan.i)::text AS confirmation,
              (8000 + (plan.i % 40) * 500)::numeric AS rate
       FROM plan
       JOIN bench_guests g ON g.gi = 1 + (plan.i::bigint * 104729) % $8::bigint
       LEFT JOIN bench_rooms r ON r.ri = plan.ri`,
      [bd, nRooms, HISTORY, inHouseRooms, FUTURE_DAYS, ARRIVALS, firstConfirmation, guestCount],
    );
    await q(`ANALYZE bench_gen`);
    const counts = (await q(`SELECT kind, count(*) FROM bench_gen GROUP BY kind ORDER BY kind`))
      .rows;
    log(`${property.code}: planned ${counts.map((c) => `${c.kind}=${c.count}`).join(" ")}`);

    const params = [p, template.source_code_id, template.market_code_id, actor];
    await q(
      `INSERT INTO reservations (id, property_id, confirmation_number, booker_guest_id, source_code_id, market_code_id,
                                 booked_by_id, booked_at, created_at, updated_at)
       SELECT res_id, $1, confirmation, guest_id, $2, $3, $4,
              (arrival - 30)::timestamptz, (arrival - 30)::timestamptz, (arrival - 30)::timestamptz
       FROM bench_gen`,
      params,
    );
    await q(
      `INSERT INTO reservation_rooms (id, property_id, reservation_id, line_number, status, primary_guest_id,
                                      arrival_date, departure_date, adults, room_type_id, rate_room_type_id, room_id,
                                      rate_plan_id, currency_code, reservation_type_id, market_code_id, source_code_id,
                                      created_at, updated_at)
       SELECT rr_id, $1, res_id, 1,
              (CASE kind WHEN 'H' THEN 'CHECKED_OUT' WHEN 'I' THEN 'IN_HOUSE' ELSE 'RESERVED' END)::reservation_status,
              guest_id, arrival, departure, 1 + i % 3, room_type_id, room_type_id,
              CASE WHEN kind = 'F' THEN NULL ELSE room_id END,
              $2, $3, $4, $5, $6, (arrival - 30)::timestamptz, now()
       FROM bench_gen`,
      [
        p,
        template.rate_plan_id,
        template.currency_code,
        template.reservation_type_id,
        template.market_code_id,
        template.source_code_id,
      ],
    );
    await q(
      `INSERT INTO reservation_guests (reservation_room_id, guest_id, is_primary) SELECT rr_id, guest_id, true FROM bench_gen`,
    );
    await q(
      `INSERT INTO reservation_room_nights (property_id, reservation_room_id, stay_date, room_type_id, rate_plan_id,
                                            rate_amount, currency_code, adults, posted_at)
       SELECT $1, rr_id, arrival + n, room_type_id, $2, rate, $3, 1 + i % 3,
              CASE WHEN arrival + n < $4::date THEN (arrival + n + 1)::timestamptz END
       FROM bench_gen, LATERAL generate_series(0, nights - 1) AS n`,
      [p, template.rate_plan_id, template.currency_code, bd],
    );
    log(`${property.code}: reservations, rooms, guests, nights`);

    await q(
      `INSERT INTO stays (id, property_id, reservation_room_id, primary_guest_id, room_id, status, checked_in_at,
                          checked_in_by_id, arrival_business_date, checked_out_at, checked_out_by_id,
                          departure_business_date, updated_at)
       SELECT stay_id, $1, rr_id, guest_id, room_id,
              (CASE WHEN kind = 'H' THEN 'CHECKED_OUT' ELSE 'IN_HOUSE' END)::stay_status,
              arrival + time '14:00', $2, arrival,
              CASE WHEN kind = 'H' THEN departure + time '11:00' END,
              CASE WHEN kind = 'H' THEN $2::uuid END,
              CASE WHEN kind = 'H' THEN departure END, now()
       FROM bench_gen WHERE kind <> 'F'`,
      [p, actor],
    );
    await q(
      `UPDATE rooms SET front_office_status = 'OCCUPIED', housekeeping_status = 'DIRTY', updated_at = now()
       WHERE id IN (SELECT room_id FROM bench_gen WHERE kind = 'I')`,
    );

    // Folios: history settled (payment clears the balance), in-house open with posted nights.
    await q(
      `INSERT INTO folios (id, property_id, owner_type, reservation_room_id, payee_guest_id, status, currency_code,
                           charges_total, credits_total, balance, opened_by_id, opened_at, updated_at, settled_at, settled_by_id)
       SELECT folio_id, $1, 'GUEST', rr_id, guest_id,
              (CASE WHEN kind = 'H' THEN 'SETTLED' ELSE 'OPEN' END)::folio_status, $2,
              t.total, CASE WHEN kind = 'H' THEN -t.total ELSE 0 END, CASE WHEN kind = 'H' THEN 0 ELSE t.total END,
              $3, arrival + time '14:00', now(),
              CASE WHEN kind = 'H' THEN departure + time '10:30' END, CASE WHEN kind = 'H' THEN $3::uuid END
       FROM bench_gen,
            LATERAL (SELECT CASE WHEN kind = 'H' THEN rate * nights + CASE WHEN i % 2 = 0 THEN 2500 ELSE 0 END
                                 ELSE rate * GREATEST(0, LEAST(nights, $4::date - arrival)) END AS total) t
       WHERE kind <> 'F'`,
      [p, template.currency_code, actor, bd],
    );
    await q(
      `INSERT INTO payments (id, property_id, kind, status, folio_id, reservation_id, method_id, amount, currency_code,
                             business_date, created_by_id, created_at, captured_at)
       SELECT pay_id, $1, 'PAYMENT', 'CAPTURED', folio_id, res_id, $2, rate * nights + CASE WHEN i % 2 = 0 THEN 2500 ELSE 0 END,
              $3, departure, $4, departure + time '10:30', departure + time '10:30'
       FROM bench_gen WHERE kind = 'H'`,
      [p, method, template.currency_code, actor],
    );
    await q(
      `INSERT INTO folio_items (id, property_id, folio_id, kind, source, transaction_code_id, business_date, revenue_date,
                                unit_amount, amount, currency_code, description, origin_reservation_room_id, room_id,
                                posted_by_id, posted_at)
       SELECT gen_random_uuid(), $1, folio_id, 'CHARGE', 'NIGHT_AUDIT', $2, arrival + n, arrival + n, rate, rate, $3,
              'Room charge', rr_id, room_id, $4, (arrival + n + 1)::timestamptz
       FROM bench_gen, LATERAL generate_series(0, nights - 1) AS n
       WHERE kind = 'H' OR (kind = 'I' AND arrival + n < $5::date)`,
      [p, roomCode, template.currency_code, actor, bd],
    );
    await q(
      `INSERT INTO folio_items (id, property_id, folio_id, kind, source, transaction_code_id, business_date, revenue_date,
                                unit_amount, amount, currency_code, description, origin_reservation_room_id, room_id,
                                posted_by_id, posted_at)
       SELECT gen_random_uuid(), $1, folio_id, 'CHARGE', 'POS', $2, arrival, arrival, 2500, 2500, $3, 'Restaurant',
              rr_id, room_id, $4, arrival + time '20:00'
       FROM bench_gen WHERE kind = 'H' AND i % 2 = 0`,
      [p, fbCode, template.currency_code, actor],
    );
    await q(
      `INSERT INTO folio_items (id, property_id, folio_id, kind, source, transaction_code_id, business_date,
                                unit_amount, amount, currency_code, description, payment_id, posted_by_id, posted_at)
       SELECT gen_random_uuid(), $1, folio_id, 'PAYMENT', 'MANUAL', $2, departure,
              -(rate * nights + CASE WHEN i % 2 = 0 THEN 2500 ELSE 0 END), -(rate * nights + CASE WHEN i % 2 = 0 THEN 2500 ELSE 0 END),
              $3, 'Payment', pay_id, $4, departure + time '10:30'
       FROM bench_gen WHERE kind = 'H'`,
      [p, payCode, template.currency_code, actor],
    );
    log(`${property.code}: stays, folios, folio items, payments`);

    // Housekeeping history, room status history, audit trail.
    await q(
      `INSERT INTO housekeeping_tasks (id, property_id, room_id, task_type_id, business_date, status, stay_id,
                                       started_at, completed_at, completed_by_id, inspected_at, inspected_by_id,
                                       created_at, updated_at)
       SELECT gen_random_uuid(), $1, room_id, $2, departure, 'INSPECTED', stay_id,
              departure + time '11:30', departure + time '12:10', $3, departure + time '12:30', $3,
              departure + time '11:00', departure + time '12:30'
       FROM bench_gen WHERE kind = 'H'
       ON CONFLICT DO NOTHING`,
      [p, taskType, actor],
    );
    await q(
      `INSERT INTO room_status_history (id, property_id, room_id, field, from_value, to_value, business_date, source,
                                        changed_by_id, created_at)
       SELECT gen_random_uuid(), $1, room_id, 'HOUSEKEEPING', v.f, v.t, departure, v.s, $2, departure + v.at
       FROM bench_gen,
            LATERAL (VALUES ('CLEAN', 'DIRTY', 'CHECK_OUT', time '11:00'), ('DIRTY', 'CLEAN', 'HOUSEKEEPING', time '12:10')) AS v(f, t, s, at)
       WHERE kind = 'H'`,
      [p, actor],
    );
    await q(
      `INSERT INTO audit_logs (id, organization_id, property_id, user_id, action, resource_type, resource_id,
                               business_date, after, created_at)
       SELECT gen_random_uuid(), $1, $2, $3, v.action, v.rtype, v.rid::text, v.bdate,
              jsonb_build_object('confirmation', confirmation), v.at
       FROM bench_gen,
            LATERAL (VALUES ('reservation.create', 'Reservation', res_id, arrival - 30, (arrival - 30)::timestamptz),
                            ('stay.check_in', 'Stay', stay_id, arrival, arrival + time '14:00'),
                            ('stay.check_out', 'Stay', stay_id, departure, departure + time '11:00'),
                            ('payment.capture', 'Payment', pay_id, departure, departure + time '10:30')) AS v(action, rtype, rid, bdate, at)
       WHERE kind = 'H'`,
      [org, p, actor],
    );
    log(`${property.code}: housekeeping, status history, audit trail`);

    // Inventory: sold nights of today's in-house and future reservations.
    await q(
      `UPDATE room_type_inventory inv SET sold = inv.sold + s.n, updated_at = now()
       FROM (SELECT nt.room_type_id, nt.stay_date, count(*) AS n
             FROM reservation_room_nights nt JOIN bench_gen g ON g.rr_id = nt.reservation_room_id
             WHERE g.kind <> 'H' GROUP BY 1, 2) s
       WHERE inv.property_id = $1 AND inv.room_type_id = s.room_type_id AND inv.stay_date = s.stay_date`,
      [p],
    );
    log(`${property.code}: done`);
  }
} finally {
  for (const table of TRIGGERED) await q(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
}

await q(`ANALYZE`);
const sizes = await q(
  `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 1000 ORDER BY n_live_tup DESC`,
);
for (const row of sizes.rows)
  console.log(`${row.relname.padEnd(28)} ${Number(row.n_live_tup).toLocaleString("en")}`);
console.log(
  `database size: ${(await q(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`)).rows[0].s}`,
);
log("done");
await client.end();
