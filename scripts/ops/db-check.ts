/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * `npm run ops:db-check` — read-only database posture check for deployments
 * and restore drills (docs/OPERATIONS.md §4, §6). Connects exactly like the
 * application (DATABASE_URL, same pool settings) and reports:
 *
 * - FAIL: append-only / TRUNCATE guard triggers missing or disabled, session
 *   zone not UTC, no statement timeout, failed or unfinished migrations.
 * - WARN: the runtime role is a superuser, owns application tables (and so
 *   could disable the guards) or holds TRUNCATE on a guarded table — i.e.
 *   the owner/runtime role split (D53) is not in place.
 *
 *   npm run ops:db-check -- [--strict]      (--strict: warnings also fail)
 *
 * Prints names and counts only. Exit codes: 0 ok · 1 failed · 2 invalid arguments.
 */
import { parseArgs } from "node:util";
import { GUARDED_TABLES } from "./db-guards";
import { loadEnvFileIfPresent } from "./env-file";

async function main(): Promise<number> {
  let strict = false;
  try {
    const { values } = parseArgs({
      options: { strict: { type: "boolean", default: false } },
      strict: true,
    });
    strict = values.strict;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid arguments");
    return 2;
  }

  loadEnvFileIfPresent();
  const { serverEnv } = await import("../../lib/env");
  serverEnv();
  const { prisma } = await import("../../lib/db/prisma");
  const failures: string[] = [];
  const warnings: string[] = [];
  const ok: string[] = [];
  try {
    const [role] = await prisma.$queryRaw<
      { name: string; superuser: boolean; owned: number; truncatable: number }[]
    >`
      SELECT current_user AS name,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
             (SELECT count(*)::int FROM pg_tables
               WHERE schemaname = 'public' AND tableowner = current_user) AS owned,
             (SELECT count(*)::int FROM unnest(${GUARDED_TABLES as unknown as string[]}::text[]) t
               WHERE has_table_privilege(current_user, format('public.%I', t), 'TRUNCATE')) AS truncatable`;
    if (role!.superuser) warnings.push(`runtime role ${role!.name} is a superuser`);
    if (role!.owned > 0) {
      warnings.push(
        `runtime role ${role!.name} owns ${role!.owned} tables (it could disable the guards; see D53)`,
      );
    }
    if (role!.truncatable > 0) {
      warnings.push(`runtime role may TRUNCATE ${role!.truncatable} guarded tables`);
    }
    if (!role!.superuser && role!.owned === 0 && role!.truncatable === 0) {
      ok.push(`runtime role ${role!.name}: not owner, no TRUNCATE on guarded tables`);
    }

    const guards = await prisma.$queryRaw<{ table: string; kind: string; enabled: string }[]>`
      SELECT c.relname AS "table",
             CASE WHEN (t.tgtype & 32) <> 0 THEN 'truncate' ELSE 'row' END AS kind,
             t.tgenabled::text AS enabled
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
        AND c.relname = ANY(${GUARDED_TABLES as unknown as string[]}::text[])
        AND t.tgfoid IN (SELECT oid FROM pg_proc WHERE proname LIKE 'serene\\_%')`;
    const missingTruncate = GUARDED_TABLES.filter(
      (table) => !guards.some((g) => g.table === table && g.kind === "truncate"),
    );
    const missingRow = GUARDED_TABLES.filter(
      (table) => !guards.some((g) => g.table === table && g.kind === "row"),
    );
    const disabled = guards.filter((g) => g.enabled === "D").map((g) => g.table);
    if (missingTruncate.length)
      failures.push(`TRUNCATE guard missing on: ${missingTruncate.join(", ")}`);
    if (missingRow.length) failures.push(`row guard missing on: ${missingRow.join(", ")}`);
    if (disabled.length)
      failures.push(`guard triggers DISABLED on: ${[...new Set(disabled)].join(", ")}`);
    if (!missingTruncate.length && !missingRow.length && !disabled.length) {
      ok.push(`guard triggers present and enabled on ${GUARDED_TABLES.length} tables`);
    }

    const [settings] = await prisma.$queryRaw<
      { timezone: string; statement_timeout: string; idle_tx: string }[]
    >`
      SELECT current_setting('TimeZone') AS timezone,
             current_setting('statement_timeout') AS statement_timeout,
             current_setting('idle_in_transaction_session_timeout') AS idle_tx`;
    if (settings!.timezone !== "UTC")
      failures.push(`session TimeZone is ${settings!.timezone}, not UTC`);
    if (settings!.statement_timeout === "0") failures.push("statement_timeout is disabled");
    // Behind a transaction-mode PgBouncer these come from the runtime role, not the app.
    if (settings!.idle_tx === "0") failures.push("idle_in_transaction_session_timeout is disabled");

    // Connection budget (docs/OPERATIONS.md §6): each instance holds up to
    // DATABASE_POOL_MAX pooled connections plus one LISTEN connection for live
    // updates and one for its job worker (JOB_WORKER=inline). The inline worker
    // shares the pool. Separate `npm run worker` processes count as instances.
    const [limits] = await prisma.$queryRaw<{ max: number; reserved: number }[]>`
      SELECT current_setting('max_connections')::int AS max,
             current_setting('superuser_reserved_connections')::int AS reserved`;
    const env = serverEnv();
    const listens = (env.REALTIME_ENABLED === "1" ? 1 : 0) + (env.JOB_WORKER === "inline" ? 1 : 0);
    const perInstance = env.DATABASE_POOL_MAX + listens;
    // Keep 10 connections for migrations, backups, monitoring and administrators.
    const fits = Math.floor((limits!.max - limits!.reserved - 10) / perInstance);
    if (env.DATABASE_POOLER === "pgbouncer-transaction") {
      // PgBouncer, not the instances, decides the server connections.
      ok.push(
        `connection budget: max_connections=${limits!.max}; behind PgBouncer keep ` +
          `default_pool_size + LISTEN connections (up to 2 per instance) + 10 below it`,
      );
    } else {
      const budget =
        `connection budget: max_connections=${limits!.max}, ${perInstance} per instance ` +
        `(DATABASE_POOL_MAX=${env.DATABASE_POOL_MAX}` +
        `${listens > 0 ? ` + ${listens} LISTEN` : ""}) → at most ${fits} instances`;
      if (fits < 2) warnings.push(`${budget}: fewer than 2 instances fit`);
      else ok.push(budget);
    }
    if (settings!.timezone === "UTC" && settings!.statement_timeout !== "0") {
      ok.push(
        `session: TimeZone=UTC, statement_timeout=${settings!.statement_timeout}, ` +
          `idle_in_transaction_session_timeout=${settings!.idle_tx}`,
      );
    }

    const [migrations] = await prisma.$queryRaw<{ applied: number; unfinished: number }[]>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
             count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished
      FROM _prisma_migrations`;
    if (migrations!.unfinished > 0) {
      failures.push(
        `${migrations!.unfinished} failed or unfinished migrations (see docs/OPERATIONS.md §3)`,
      );
    } else {
      ok.push(`${migrations!.applied} migrations applied, none failed`);
    }
  } finally {
    await prisma.$disconnect();
  }

  for (const line of ok) console.log(`OK    ${line}`);
  for (const line of warnings) console.log(`WARN  ${line}`);
  for (const line of failures) console.log(`FAIL  ${line}`);
  if (failures.length > 0 || (strict && warnings.length > 0)) return 1;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database check failed");
    process.exit(1);
  });
