/* eslint-disable no-console -- load-test command: prints its result to the terminal */
// Sampling profiler for PostgreSQL during a load test (docs/SCALABILITY.md): where the
// database spends its time when pg_stat_statements is not available (it needs a
// superuser to preload). Samples pg_stat_activity every INTERVAL ms for SECONDS and
// ranks statements by the share of samples in which they were running, with their wait
// events. Statement text is shown up to 300 characters; bind values are never visible.
//
//   DATABASE_URL=…/serene_bench node scripts/load/pg-sample.mjs 20
import pg from "pg";

const seconds = Number(process.argv[2] ?? 20);
const INTERVAL = Number(process.env.INTERVAL ?? 200);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const counts = new Map();
let samples = 0;
let activeTotal = 0;
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  const rows = (
    await client.query(
      `SELECT query, COALESCE(wait_event_type || ':' || wait_event, 'CPU') AS wait
       FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()`,
    )
  ).rows;
  samples++;
  activeTotal += rows.length;
  for (const row of rows) {
    const key = row.query
      .replace(/\s+/g, " ")
      .replace(/\$\d+(,\s*\$\d+)+/g, "$…")
      .slice(0, 300);
    const entry = counts.get(key) ?? { n: 0, waits: new Map() };
    entry.n++;
    entry.waits.set(row.wait, (entry.waits.get(row.wait) ?? 0) + 1);
    counts.set(key, entry);
  }
  await new Promise((r) => setTimeout(r, INTERVAL));
}
await client.end();

console.log(`${samples} samples, average ${(activeTotal / samples).toFixed(2)} active statements`);
for (const [query, entry] of [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
  const waits = [...entry.waits]
    .map(([w, n]) => `${w} ${Math.round((n / entry.n) * 100)}%`)
    .join(", ");
  console.log(`\n${((entry.n / activeTotal) * 100).toFixed(1)}% of DB time [${waits}]\n  ${query}`);
}
