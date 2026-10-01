import type { PoolConfig } from "pg";

/**
 * PostgreSQL connection settings for the application pool (docs/ARCHITECTURE.md
 * D52, D64, docs/OPERATIONS.md §6). Pure, so it can be tested without a server.
 *
 * Session settings travel as startup parameters (`options`):
 * - TimeZone=UTC: every session runs in UTC (D29); @prisma/adapter-pg relies
 *   on it to store and read timestamptz values correctly.
 * - statement_timeout: no accidental query runs forever. Work with known-long
 *   statements raises it for its own transaction (runInTransaction's
 *   `statementTimeoutMs`, used by the night audit commit).
 * - idle_in_transaction_session_timeout: a transaction left open by a bug
 *   cannot hold row locks indefinitely.
 *
 * A transaction-pooling PgBouncer does not accept `options`
 * (DATABASE_POOLER=pgbouncer-transaction): they are then not sent, and must
 * be set on the runtime role instead (ALTER ROLE … SET); `npm run
 * ops:db-check` fails when the session zone is not UTC or there is no
 * statement timeout. See docs/OPERATIONS.md §6.
 */
export interface DatabaseSettings {
  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
  DATABASE_POOL_MIN?: number;
  DATABASE_POOL_IDLE_TIMEOUT_MS?: number;
  DATABASE_POOL_MAX_LIFETIME_S?: number;
  DATABASE_POOLER?: "none" | "pgbouncer-transaction";
  DATABASE_CONNECT_TIMEOUT_MS: number;
  DATABASE_STATEMENT_TIMEOUT_MS: number;
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: number;
}

/**
 * Idle pooled connections above the minimum are closed after this long by
 * default (DATABASE_POOL_IDLE_TIMEOUT_MS; docs/SCALABILITY.md §32).
 */
export const POOL_IDLE_TIMEOUT_MS = 120_000;

/** The session settings every application connection needs (sent or set on the role). */
export function sessionParameters(settings: DatabaseSettings): Record<string, string> {
  return {
    TimeZone: "UTC",
    statement_timeout: String(Math.trunc(settings.DATABASE_STATEMENT_TIMEOUT_MS)),
    idle_in_transaction_session_timeout: String(
      Math.trunc(settings.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS),
    ),
  };
}

export function pgPoolConfig(settings: DatabaseSettings): PoolConfig {
  const viaPgBouncer = settings.DATABASE_POOLER === "pgbouncer-transaction";
  return {
    connectionString: settings.DATABASE_URL,
    max: settings.DATABASE_POOL_MAX,
    min: settings.DATABASE_POOL_MIN ?? 0,
    connectionTimeoutMillis: settings.DATABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: settings.DATABASE_POOL_IDLE_TIMEOUT_MS ?? POOL_IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: settings.DATABASE_POOL_MAX_LIFETIME_S ?? 0,
    application_name: "serene-management",
    ...(viaPgBouncer
      ? {}
      : {
          options: Object.entries(sessionParameters(settings))
            .map(([name, value]) => `-c ${name}=${value}`)
            .join(" "),
        }),
  };
}
