import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "./prisma";

const RETRYABLE_PRISMA_CODES = new Set(["P2034"]); // write conflict / deadlock
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]); // serialization failure, deadlock
const MAX_ATTEMPTS = 3;

export interface TransactionOptions {
  /** Longest the transaction may run (default 15 s; night audit's commit uses more). */
  timeoutMs?: number;
  /** Longest to wait for a pooled connection (default 5 s). */
  maxWaitMs?: number;
  /** Retry serialization failures and deadlocks (default true). */
  retry?: boolean;
  /**
   * Raises this transaction's statement timeout above the session default
   * (DATABASE_STATEMENT_TIMEOUT_MS) for work with known-long statements,
   * such as the night audit commit. Scoped with SET LOCAL semantics.
   */
  statementTimeoutMs?: number;
}

/**
 * Runs one unit of work (one service command) in an interactive transaction
 * (docs/ARCHITECTURE.md §5). Serialization failures and deadlocks are retried
 * with jitter; business errors are never retried.
 */
export async function runInTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const attempts = options.retry === false ? 1 : MAX_ATTEMPTS;
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          if (options.statementTimeoutMs !== undefined) {
            const ms = Math.trunc(options.statementTimeoutMs);
            await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(ms)}, true)`;
          }
          return work(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: options.maxWaitMs ?? 5_000,
          timeout: options.timeoutMs ?? 15_000,
        },
      );
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (RETRYABLE_PRISMA_CODES.has(error.code)) return true;
  }
  const sqlState = databaseErrorCode(error);
  return sqlState !== undefined && RETRYABLE_SQLSTATES.has(sqlState);
}

/**
 * Extracts the PostgreSQL SQLSTATE from errors raised through the pg driver
 * adapter (the adapter preserves it as `cause.originalCode` / `meta`).
 */
export function databaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const candidate = current as {
      code?: unknown;
      originalCode?: unknown;
      meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } };
      cause?: unknown;
    };
    for (const value of [
      candidate.originalCode,
      candidate.meta?.driverAdapterError?.cause?.originalCode,
      candidate.meta?.code,
      candidate.code,
    ]) {
      if (typeof value === "string" && /^[0-9A-Z]{5}$/.test(value) && !value.startsWith("P"))
        return value;
    }
    current = candidate.cause;
  }
  return undefined;
}

/** Prisma's codes for an unreachable or lost database, and a pool that had no connection to give. */
const CONNECTION_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
const CONNECTION_MESSAGES =
  /connection terminated|connection (?:was )?closed|ECONNRESET|ECONNREFUSED|server closed the connection|Connection lost/i;

/**
 * Whether an error means the database was unreachable or the connection was
 * lost (not that the work was wrong): SQLSTATE class 08, the server shutting
 * down or terminating the session (57P01-57P03), too many connections
 * (53300), or the driver's own connection errors. Background jobs retry such
 * failures instead of recording them as the outcome of the work.
 */
export function isConnectionError(error: unknown): boolean {
  const sqlState = databaseErrorCode(error);
  if (
    sqlState &&
    (sqlState.startsWith("08") || ["57P01", "57P02", "57P03", "53300"].includes(sqlState))
  ) {
    return true;
  }
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && CONNECTION_PRISMA_CODES.has(candidate.code))
      return true;
    if (typeof candidate.message === "string" && CONNECTION_MESSAGES.test(candidate.message))
      return true;
    current = candidate.cause;
  }
  return false;
}
