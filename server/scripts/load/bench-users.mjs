/* eslint-disable no-console -- load-test command: prints its result to the terminal */
// Benchmark staff accounts (docs/SCALABILITY.md). NON-PRODUCTION ONLY.
//
// Creates BENCH_USERS accounts bench.user0001@serene.test … with the General Manager
// role at organization scope and the password BENCH_PASSWORD, in a database whose name
// ends in _bench. Many accounts are needed because several API limits are per user
// (availability 60/min, reports 120/min), as they would be across a hotel chain.
//
//   DATABASE_URL=…/serene_bench BENCH_PASSWORD=… BENCH_USERS=200 node scripts/load/bench-users.mjs
import { hash } from "@node-rs/argon2";
import pg from "pg";

const url = process.env.DATABASE_URL;
const password = process.env.BENCH_PASSWORD;
const count = Number(process.env.BENCH_USERS ?? 200);
if (!url || !password) throw new Error("DATABASE_URL and BENCH_PASSWORD are required");
const database = new URL(url).pathname.slice(1);
if (!/_bench$/.test(database) || process.env.NODE_ENV === "production") {
  throw new Error(
    `Refusing to create benchmark users in "${database}": the name must end in _bench`,
  );
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const org = (await client.query(`SELECT id FROM organizations LIMIT 1`)).rows[0].id;
const role = (
  await client.query(
    `SELECT id FROM roles WHERE organization_id = $1 AND code = 'GENERAL_MANAGER'`,
    [org],
  )
).rows[0].id;
const admin = (
  await client.query(
    `SELECT id FROM users WHERE organization_id = $1 ORDER BY created_at LIMIT 1`,
    [org],
  )
).rows[0].id;
const passwordHash = await hash(password);
await client.query(
  `INSERT INTO users (id, organization_id, email, display_name, password_hash, password_changed_at, status, updated_at)
   SELECT gen_random_uuid(), $1, 'bench.user' || lpad(i::text, 4, '0') || '@serene.test', 'Bench User ' || i, $2,
          now() - interval '1 day', 'ACTIVE', now()
   FROM generate_series(1, $3::int) AS i
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE'`,
  [org, passwordHash, count],
);
await client.query(
  `INSERT INTO user_role_assignments (id, user_id, role_id, scope, property_id, granted_by_id)
   SELECT gen_random_uuid(), u.id, $1, 'ORGANIZATION', NULL, $2 FROM users u
   WHERE u.email LIKE 'bench.user%@serene.test'
     AND NOT EXISTS (SELECT 1 FROM user_role_assignments a WHERE a.user_id = u.id AND a.role_id = $1)`,
  [role, admin],
);
console.log(`${count} benchmark users ready in ${database}`);
await client.end();
