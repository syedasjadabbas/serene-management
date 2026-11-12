/* eslint-disable no-console -- operator command: prints its progress to the terminal */
/**
 * `npm run worker` (dist/workers/worker.mjs) — a background job worker process (docs/SCALABILITY.md §33,
 * docs/OPERATIONS.md §6). Runs the jobs the application queues (night audit)
 * outside the web processes; set JOB_WORKER=off on those to leave every job to
 * workers like this one (the web process then starts no inline worker). Any number may run, on any host that reaches the
 * database: jobs are claimed atomically and never run twice at once.
 *
 *   npm run worker -- [--once] [--stats] [--metrics-port <port>]
 *
 * --once   runs the jobs due now, then exits (cron-style, or to drain a queue).
 * --stats  prints the queue's health (counts, oldest due job, expired leases)
 *          and exits.
 * --metrics-port  serves GET /metrics (Prometheus text, METRICS_TOKEN as a
 *          bearer token; docs/OPERATIONS.md §11) on that port while running.
 *
 * SIGTERM / SIGINT: stops claiming and waits up to 60 s for running jobs. A
 * job still running then (or one whose process was killed) is re-claimed by
 * another worker once its lease expires; nothing is lost.
 *
 * Kill switch: JOB_WORKER=off in THIS process's environment makes the worker log
 * one line and exit 0 without claiming anything (--stats still works, read-only).
 * The same value stops the inline worker of a web process, so one variable is
 * the off switch everywhere; give each process its own value (a shared .env
 * with JOB_WORKER=off would also stop the separate workers).
 *
 * Idle behaviour: a tick is a read-first claim (SELECT … FOR UPDATE SKIP LOCKED
 * inside a CTE; the UPDATE only touches the row it found) and a lease reclaim at
 * most once per poll interval; with nothing due neither writes a row. Jobs are
 * idempotent by design: queued with an active-dedupe key (unique while
 * QUEUED/RUNNING), claimed atomically, writes fenced on the lease.
 *
 * Prints one JSON line per job event (no payloads, no personal data).
 * Exit codes: 0 done · 1 error · 2 invalid arguments.
 */
import { parseArgs } from "node:util";
import { loadEnvFileIfPresent } from "@/scripts/ops/env-file";

const USAGE = "Usage: npm run worker -- [--once] [--stats] [--metrics-port <port>]";

async function main(): Promise<number> {
  let values: { once: boolean; stats: boolean; help: boolean; "metrics-port"?: string };
  try {
    ({ values } = parseArgs({
      options: {
        once: { type: "boolean", default: false },
        stats: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        "metrics-port": { type: "string" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : "Invalid arguments"}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  loadEnvFileIfPresent();
  const { serverEnv } = await import("@/config/env");
  let env: ReturnType<typeof serverEnv>;
  try {
    env = serverEnv();
  } catch (error) {
    // Names the variables and rules, never their values (as the web server does).
    console.error(error instanceof Error ? error.message : "Invalid server environment");
    return 1;
  }
  const { prisma } = await import("@/config/prisma");
  const { jobQueueStats } = await import("@/modules/jobs/jobs.service");
  if (values.stats) {
    console.log(JSON.stringify(await jobQueueStats()));
    await prisma.$disconnect();
    return 0;
  }

  const { jobWorkerOff } = await import("@/lib/jobs/switch");
  if (jobWorkerOff(env.JOB_WORKER)) {
    console.log(
      JSON.stringify({ at: new Date(), type: "disabled", reason: "JOB_WORKER=off; not starting" }),
    );
    await prisma.$disconnect();
    return 0;
  }
  const { JobWorker, workerOptionsFromEnv } = await import("@/lib/jobs/worker");
  const { jobHandlers } = await import("@/lib/jobs/registry");
  const worker = new JobWorker(
    jobHandlers(),
    workerOptionsFromEnv((event) => console.log(JSON.stringify({ at: new Date(), ...event }))),
  );
  if (values.once) {
    const count = await worker.runDue();
    console.log(JSON.stringify({ at: new Date(), type: "drained", attempts: count }));
    await prisma.$disconnect();
    return 0;
  }

  worker.start();
  const { registerProcessMetrics } = await import("@/lib/observability/register");
  registerProcessMetrics("worker");
  const metricsServer = values["metrics-port"]
    ? await serveMetrics(Number(values["metrics-port"]), serverEnv().METRICS_TOKEN)
    : null;
  console.log(
    JSON.stringify({ at: new Date(), type: "started", worker: worker.id, kinds: worker.kinds }),
  );
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
  console.log(JSON.stringify({ at: new Date(), type: "stopping", running: worker.running }));
  await worker.stop(60_000);
  metricsServer?.close();
  await prisma.$disconnect();
  return 0;
}

/** GET /metrics with the bearer token; anything else 404. Refuses to start without a token. */
async function serveMetrics(port: number, token: string | undefined) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || !token) {
    throw new Error("--metrics-port needs a valid port and METRICS_TOKEN");
  }
  const { createServer } = await import("node:http");
  const { timingSafeEqual } = await import("node:crypto");
  const { renderMetrics } = await import("@/lib/observability/metrics");
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer((req, res) => {
    const given = Buffer.from(req.headers.authorization ?? "");
    const allowed =
      req.method === "GET" &&
      req.url === "/metrics" &&
      given.length === expected.length &&
      timingSafeEqual(given, expected);
    if (!allowed) {
      res.writeHead(404).end();
      return;
    }
    renderMetrics().then(
      (text) => res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }).end(text),
      () => res.writeHead(500).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return server;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Worker failed:", error instanceof Error ? error.name : "unknown error");
    process.exit(1);
  },
);
