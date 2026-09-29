/* eslint-disable no-console -- load-test command: prints its result to the terminal */
// Resource monitor for load tests (docs/SCALABILITY.md). Samples every INTERVAL ms until
// DURATION seconds pass, then prints averages and peaks and writes the samples as JSON.
//
//   DATABASE_URL=…/serene_bench node scripts/load/monitor.mjs <serverPid> <seconds> <out.json>
//
// Application: CPU % (of one core) and working set of the server process. Machine: total
// CPU % (all cores). PostgreSQL: CPU % (of one core) of all postgres processes, connections by state, sessions waiting on
// locks, longest running statement, commits/s, rollbacks/s, buffer cache hit ratio,
// temp bytes and deadlocks of the database. Windows (PowerShell) and Linux (/proc via ps).
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import pg from "pg";

const [pidArg, secondsArg, out] = process.argv.slice(2);
const serverPid = Number(pidArg);
const seconds = Number(secondsArg ?? 60);
const INTERVAL = Number(process.env.INTERVAL ?? 2000);
if (!serverPid || !out) throw new Error("usage: monitor.mjs <serverPid> <seconds> <out.json>");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

function processTimes() {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      // PostgreSQL runs as a service account whose process CPU times are not readable
      // by a normal user; performance counters are (1 s sample, % of one core).
      const script =
        "$c = (Get-Counter '\\Process(postgres*)\\% Processor Time','\\Processor(_Total)\\% Processor Time' -SampleInterval 1).CounterSamples;" +
        "'pg ' + ($c | Where-Object { $_.Path -like '*postgres*' } | Measure-Object CookedValue -Sum).Sum;" +
        "'total ' + ($c | Where-Object { $_.Path -like '*_total*' }).CookedValue;" +
        // The server's own instance among all node processes, matched by PID.
        "$n = (Get-Counter '\\Process(node*)\\ID Process','\\Process(node*)\\% Processor Time' -SampleInterval 1).CounterSamples;" +
        `$idp = ($n | Where-Object { $_.Path -like '*id process' -and $_.CookedValue -eq ${serverPid} } | Select-Object -First 1).Path -replace 'id process$', '% processor time';` +
        "'appcpu ' + ($n | Where-Object { $_.Path -eq $idp }).CookedValue;" +
        `$p = Get-Process -Id ${serverPid} -ErrorAction SilentlyContinue; 'app ' + $p.CPU + ' ' + $p.WorkingSet64`;
      execFile("powershell", ["-NoProfile", "-Command", script], (error, stdout, stderr) => {
        if (process.env.MONITOR_DEBUG) console.error(stdout, stderr);
        if (error) return resolve(null);
        const pgLine = /pg ([\d.]+)/.exec(stdout);
        const totalLine = /total ([\d.]+)/.exec(stdout);
        const appLine = /app ([\d.]+) (\d+)/.exec(stdout);
        const appCpuLine = /appcpu ([\d.]+)/.exec(stdout);
        resolve({
          appCpuPct: appCpuLine ? Number(appCpuLine[1]) : null,
          pgCpuPct: pgLine ? Number(pgLine[1]) : null,
          machineCpuPct: totalLine ? Number(totalLine[1]) : null,
          appCpuSeconds: appLine ? Number(appLine[1]) : null,
          appMemory: appLine ? Number(appLine[2]) : null,
        });
      });
    } else {
      execFile("ps", ["-eo", "pid,comm,cputimes,rss"], (error, stdout) => {
        if (error) return resolve(null);
        let pgCpu = 0;
        let app = null;
        for (const line of stdout.split("\n").slice(1)) {
          const [pid, comm, cpu, rss] = line.trim().split(/\s+/);
          if (comm === "postgres") pgCpu += Number(cpu);
          if (Number(pid) === serverPid) app = { cpu: Number(cpu), rss: Number(rss) * 1024 };
        }
        resolve({
          pgCpuSeconds: pgCpu,
          appCpuSeconds: app?.cpu ?? null,
          appMemory: app?.rss ?? null,
        });
      });
    }
  });
}

async function dbSample() {
  const activity = (
    await client.query(
      `SELECT count(*) FILTER (WHERE state = 'active') AS active,
              count(*) FILTER (WHERE state = 'idle') AS idle,
              count(*) FILTER (WHERE state LIKE 'idle in transaction%') AS idle_in_tx,
              count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waits,
              count(*) AS total,
              COALESCE(max(extract(epoch FROM now() - query_start)) FILTER (WHERE state = 'active' AND pid <> pg_backend_pid()), 0) AS longest_s
       FROM pg_stat_activity WHERE datname = current_database()`,
    )
  ).rows[0];
  const db = (
    await client.query(
      `SELECT xact_commit, xact_rollback, blks_read, blks_hit, temp_bytes, deadlocks, tup_returned, tup_fetched
       FROM pg_stat_database WHERE datname = current_database()`,
    )
  ).rows[0];
  return { activity, db };
}

const samples = [];
const cores = cpus().length;
let previous = { at: Date.now(), times: await processTimes(), db: (await dbSample()).db };
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, INTERVAL));
  const at = Date.now();
  const [times, { activity, db }] = await Promise.all([processTimes(), dbSample()]);
  const dt = (at - previous.at) / 1000;
  const delta = (key) => Number(db[key]) - Number(previous.db[key]);
  const reads = delta("blks_read");
  const hits = delta("blks_hit");
  samples.push({
    t: Math.round((at - end + seconds * 1000) / 1000),
    appCpuPct:
      times?.appCpuPct ??
      (times?.appCpuSeconds != null && previous.times?.appCpuSeconds != null
        ? ((times.appCpuSeconds - previous.times.appCpuSeconds) / dt) * 100
        : null),
    pgCpuPct:
      times?.pgCpuPct ??
      (times?.pgCpuSeconds != null && previous.times?.pgCpuSeconds != null
        ? ((times.pgCpuSeconds - previous.times.pgCpuSeconds) / dt) * 100
        : null),
    machineCpuPct: times?.machineCpuPct ?? null,
    appMemoryMb: times?.appMemory ? times.appMemory / 1048576 : null,
    pgConnections: Number(activity.total),
    pgActive: Number(activity.active),
    pgIdle: Number(activity.idle),
    pgIdleInTx: Number(activity.idle_in_tx),
    pgLockWaits: Number(activity.lock_waits),
    pgLongestActiveS: Number(activity.longest_s),
    commitsPerS: delta("xact_commit") / dt,
    rollbacksPerS: delta("xact_rollback") / dt,
    cacheHitPct: reads + hits > 0 ? (hits / (reads + hits)) * 100 : 100,
    tempBytes: delta("temp_bytes"),
    deadlocks: delta("deadlocks"),
    tuplesReadPerS: (delta("tup_returned") + delta("tup_fetched")) / dt,
  });
  previous = { at, times, db };
}
await client.end();

const keys = Object.keys(samples[0] ?? {}).filter((k) => k !== "t");
const summary = { cores, intervalMs: INTERVAL, samples: samples.length, avg: {}, max: {} };
for (const key of keys) {
  const values = samples
    .map((s) => s[key])
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  summary.avg[key] = values.length
    ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))
    : null;
  summary.max[key] = values.length ? Number(Math.max(...values).toFixed(1)) : null;
}
writeFileSync(out, JSON.stringify({ summary, samples }, null, 1));
console.log(JSON.stringify(summary));
