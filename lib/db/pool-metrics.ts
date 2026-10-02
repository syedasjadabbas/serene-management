import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

/**
 * Pool usage of one request, for the opt-in Server-Timing header
 * (SERVER_TIMING=1, docs/SCALABILITY.md §32): time spent waiting for pooled
 * connections, how many were checked out, and how many had to be opened.
 * Nothing is measured unless the pool was instrumented (SERVER_TIMING=1).
 */
export interface PoolUsage {
  waitMs: number;
  acquisitions: number;
  opened: number;
  /** Approved replica-eligible reads by where they ran (lib/db/read-replica.ts). */
  reads: Partial<Record<"primary" | "replica" | "fallback", number>>;
}

const current = new AsyncLocalStorage<PoolUsage>();

/** The current request's usage record, when Server-Timing is on. */
export function currentPoolUsage(): PoolUsage | undefined {
  return current.getStore();
}

/** Runs `work` with its pool usage recorded into `usage`. */
export function withPoolUsage<T>(usage: PoolUsage, work: () => Promise<T>): Promise<T> {
  return current.run(usage, work);
}

/**
 * Records connection waits and new connections of every checkout. The adapter
 * checks out through `pool.connect` (transactions) and `pool.query` (which
 * calls `connect` with a callback), so both paths are measured.
 */
export function instrumentPool(pool: pg.Pool): void {
  const connect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  // Connections the pool has just opened, counted when first handed out (the
  // pool's own "connect" event does not run in the request's context).
  const fresh = new WeakSet<object>();
  pool.on("connect", (client) => fresh.add(client));
  const done = (usage: PoolUsage | undefined, started: number, client: unknown) => {
    if (!usage) return;
    usage.waitMs += performance.now() - started;
    usage.acquisitions += 1;
    if (client && typeof client === "object" && fresh.has(client)) {
      fresh.delete(client);
      usage.opened += 1;
    }
  };
  pool.connect = ((callback?: (...args: unknown[]) => void) => {
    const usage = current.getStore();
    const started = performance.now();
    if (typeof callback === "function") {
      return connect((...args: unknown[]) => {
        done(usage, started, args[1]);
        callback(...args);
      });
    }
    return (connect() as Promise<pg.PoolClient>).then((client) => {
      done(usage, started, client);
      return client;
    });
  }) as typeof pool.connect;
}
