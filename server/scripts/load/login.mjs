/* eslint-disable no-console -- load-test command: prints its result to the terminal */
// Signs in the benchmark users once and writes their access cookies for k6
// (docs/SCALABILITY.md). Access tokens live AUTH_ACCESS_TOKEN_TTL_SECONDS (15 min by
// default), so a token file is reused by every run in that window instead of signing
// in again per run (the per-account login limit is 10 per 15 minutes).
//
//   BASE=http://127.0.0.1:3100 ORIGIN=https://pms.serene-bench.test BENCH_PASSWORD=… \
//   BENCH_USERS=200 node scripts/load/login.mjs tokens.json
import { writeFileSync } from "node:fs";

const [out] = process.argv.slice(2);
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const ORIGIN = process.env.ORIGIN ?? "https://pms.serene-bench.test";
const COOKIE = process.env.COOKIE ?? "__Host-sm_at";
const password = process.env.BENCH_PASSWORD;
const count = Number(process.env.BENCH_USERS ?? 200);
if (!out || !password) throw new Error("usage: BENCH_PASSWORD=… login.mjs <tokens.json>");

const ipFor = (i) => `10.77.${Math.floor(i / 250)}.${(i % 250) + 1}`;
const users = [];
for (let i = 1; i <= count; i++) {
  const email = `bench.user${String(i).padStart(4, "0")}@serene.test`;
  const ip = ipFor(i);
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": ip },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) throw new Error(`login ${email}: no ${COOKIE} cookie`);
  users.push({ cookie: cookie.slice(COOKIE.length + 1), ip });
}
writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), users }), { mode: 0o600 });
console.log(`${users.length} sessions written`);
