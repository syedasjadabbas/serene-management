/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * `npm run ops:maintenance` — prunes transient operational data per the
 * retention policy (H6, docs/OPERATIONS.md §5): expired/revoked sessions,
 * used/expired password-reset tokens, idempotency keys past their replay
 * window, and published/failed outbox events. PENDING outbox events are
 * never removed. Schedule it daily with cron / systemd timer / Windows Task
 * Scheduler; it is safe to run repeatedly and while the application runs.
 *
 *   npm run ops:maintenance -- [--dry-run] [--batch-size 1000]
 *
 * Prints counts only. Exit codes: 0 done · 1 error · 2 invalid arguments.
 */
import { parseArgs } from "node:util";
import { loadEnvFileIfPresent } from "./env-file";

const USAGE = "Usage: npm run ops:maintenance -- [--dry-run] [--batch-size N]";

async function main(): Promise<number> {
  let values: { "dry-run": boolean; "batch-size"?: string; help: boolean };
  try {
    ({ values } = parseArgs({
      options: {
        "dry-run": { type: "boolean", default: false },
        "batch-size": { type: "string" },
        help: { type: "boolean", default: false },
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
  const batchSize = values["batch-size"] === undefined ? undefined : Number(values["batch-size"]);
  const { MIN_BATCH_SIZE, MAX_BATCH_SIZE } =
    await import("../../modules/retention/retention.policy");
  if (
    batchSize !== undefined &&
    (!Number.isInteger(batchSize) || batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE)
  ) {
    console.error(`--batch-size must be an integer from ${MIN_BATCH_SIZE} to ${MAX_BATCH_SIZE}`);
    return 2;
  }

  loadEnvFileIfPresent();
  const { serverEnv } = await import("../../lib/env");
  serverEnv();
  const { prisma } = await import("../../lib/db/prisma");
  const { runRetention } = await import("../../modules/retention/retention.service");
  try {
    const report = await runRetention(prisma, { dryRun: values["dry-run"], batchSize });
    console.log(
      report.dryRun
        ? "Retention dry run (nothing deleted):"
        : `Retention maintenance (batches of ${report.batchSize}):`,
    );
    for (const t of report.targets) {
      const count = report.dryRun ? `${t.eligible} eligible` : `${t.deleted} deleted`;
      const more = t.truncated ? " (stopped at the batch limit; run again)" : "";
      console.log(`  ${t.target.padEnd(20)} ${count} (older than ${t.retentionDays} days)${more}`);
    }
    console.log(`  outbox PENDING       ${report.pendingOutboxRetained} retained (never pruned)`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Maintenance failed");
    process.exit(1);
  });
