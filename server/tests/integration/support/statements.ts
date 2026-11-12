import pg from "pg";
import { vi } from "vitest";

/**
 * Counts the SQL statements (database round trips) a piece of work sends
 * through node-postgres, which @prisma/adapter-pg uses for every query,
 * transaction control statement included. Performance tests assert on this
 * instead of wall-clock time, so they do not depend on CI hardware (Phase 10,
 * Part C). Only for tests: the work must not overlap other database activity
 * in the same worker.
 */
export async function countStatements<T>(
  work: () => Promise<T>,
): Promise<{ result: T; statements: number; texts: string[] }> {
  const spy = vi.spyOn(pg.Client.prototype, "query");
  try {
    const result = await work();
    const texts = spy.mock.calls.map((call) => {
      const first = call[0] as unknown;
      if (typeof first === "string") return first;
      return (first as { text?: string } | undefined)?.text ?? "";
    });
    return { result, statements: spy.mock.calls.length, texts };
  } finally {
    spy.mockRestore();
  }
}

/**
 * Projected database time of a statement count at a given network latency:
 * a managed database in another availability zone adds roughly 1–5 ms per
 * round trip, which dominates serial work (M8).
 */
export function projectedSeconds(statements: number, latencyMs: number): number {
  return (statements * latencyMs) / 1000;
}
