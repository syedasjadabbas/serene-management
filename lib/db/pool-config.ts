import type { PoolConfig } from "pg";

/**
 * PostgreSQL connection settings for the application pool (docs/ARCHITECTURE.md
 * D52, docs/OPERATIONS.md §6). Pure, so it can be tested without a server.
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
 * A transaction-pooling PgBouncer does not forward `options`; set these on
 * the runtime role instead (ALTER ROLE … SET), see docs/OPERATIONS.md §6.
 */
export interface DatabaseSettings {
  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
  DATABASE_CONNECT_TIMEOUT_MS: number;
  DATABASE_STATEMENT_TIMEOUT_MS: number;
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: number;
}

/** Idle pooled connections are closed after this long (pg default). */
export const POOL_IDLE_TIMEOUT_MS = 30_000;

export function pgPoolConfig(settings: DatabaseSettings): PoolConfig {
  const parameters = {
    TimeZone: "UTC",
    statement_timeout: String(Math.trunc(settings.DATABASE_STATEMENT_TIMEOUT_MS)),
    idle_in_transaction_session_timeout: String(
      Math.trunc(settings.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS),
    ),
  };
  return {
    connectionString: settings.DATABASE_URL,
    max: settings.DATABASE_POOL_MAX,
    connectionTimeoutMillis: settings.DATABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    application_name: "serene-management",
    options: Object.entries(parameters)
      .map(([name, value]) => `-c ${name}=${value}`)
      .join(" "),
  };
}
