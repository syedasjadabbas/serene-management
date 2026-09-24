import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "./prisma";

const RETRYABLE_PRISMA_CODES = new Set(["P2034"]); // write conflict / deadlock
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]); // serialization failure, deadlock
const MAX_ATTEMPTS = 3;

/**
 * Runs one unit of work (one service command) in an interactive transaction
 * (docs/ARCHITECTURE.md §5). Serialization failures and deadlocks are retried
 * with jitter; business errors are never retried.
 */
export async function runInTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
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
