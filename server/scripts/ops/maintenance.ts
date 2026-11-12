/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * `npm run ops:maintenance` — prunes transient operational data per the
 * retention policy (H6, docs/OPERATIONS.md §5): expired/revoked sessions,
 * used/expired password-reset tokens, idempotency keys past their replay
 * window, and published/failed outbox events. PENDING outbox events are
 * never removed. Schedule it daily with cron / systemd timer / Windows Task
 * Scheduler; it is safe to run repeatedly and while the application runs.
 *
 *   npm run ops:maintenance -- [--batch-size 1000]                      dry run (default)
 *   npm run ops:maintenance -- --apply --yes --database NAME [--batch-size 1000]
 *
 * Dry run by default: counts what would be deleted, writes nothing
 * (--dry-run is accepted and changes nothing). Writing needs --apply --yes and
 * the database name (see the safety note below). Prints counts only.
 * Exit codes: 0 done · 1 error · 2 invalid arguments or refused.
 */
import { parseArgs } from "node:util";
import {
  OpsRefused,
  WRITE_OPTIONS,
  WRITE_USAGE,
  assertDatabase,
  expectedDatabase,
  resolveWriteMode,
} from "./db-guard";
import { loadEnvFileIfPresent } from "./env-file";

const USAGE = `Usage: npm run ops:maintenance -- [--apply --yes --database NAME] [--batch-size N]\n${WRITE_USAGE}`;

async function main(): Promise<number> {
  let values: ReturnType<typeof parse>;
  let mode: ReturnType<typeof resolveWriteMode>;
  try {
    values = parse();
    mode = resolveWriteMode(values);
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
    await import("@serene/shared/modules/retention/retention.policy");
  if (
    batchSize !== undefined &&
    (!Number.isInteger(batchSize) || batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE)
  ) {
    console.error(`--batch-size must be an integer from ${MIN_BATCH_SIZE} to ${MAX_BATCH_SIZE}`);
    return 2;
  }

  loadEnvFileIfPresent();
  const { serverEnv } = await import("@/config/env");
  const env = serverEnv();
  const { prisma } = await import("@/config/prisma");
  const { runRetention } = await import("../../modules/retention/retention.service");
  try {
    const [row] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    try {
      assertDatabase({
        apply: mode.apply,
        actual: row!.name,
        expected: expectedDatabase(values.database),
        nodeEnv: env.NODE_ENV,
      });
    } catch (error) {
      if (!(error instanceof OpsRefused)) throw error;
      console.error(error.message);
      return 2;
    }
    const report = await runRetention(prisma, { dryRun: !mode.apply, batchSize });
    console.log(
      report.dryRun
        ? `Retention dry run on ${row!.name} (nothing deleted; add --apply --yes --database ${row!.name} to prune):`
        : `Retention maintenance on ${row!.name} (batches of ${report.batchSize}):`,
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

function parse() {
  return parseArgs({
    options: {
      ...WRITE_OPTIONS,
      "batch-size": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  }).values;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Maintenance failed");
    process.exit(1);
  });
