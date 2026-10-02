import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { WAIT_BUCKETS, gauge, histogram } from "@/lib/observability/metrics";

/**
 * Pool measurements (docs/SCALABILITY.md §32, §38).
 *
 * - Always: every checkout's wait and how long the connection was held
 *   (histograms), and each pool's size, idle and waiting counts (gauges), for
 *   GET /api/metrics. Two `performance.now()` calls per checkout.
 * - Per request: wait time, checkouts and newly opened connections, recorded
 *   into the request's usage record. The opt-in Server-Timing header
 *   (SERVER_TIMING=1) and the slow-request log read it.
 */
export interface PoolUsage {
  waitMs: number;
  acquisitions: number;
  opened: number;
  /** Approved replica-eligible reads by where they ran (lib/db/read-replica.ts). */
  reads: Partial<Record<"primary" | "replica" | "fallback", number>>;
}

const current = new AsyncLocalStorage<PoolUsage>();

/** The current request's usage record. */
export function currentPoolUsage(): PoolUsage | undefined {
  return current.getStore();
}

/** Runs `work` with its pool usage recorded into `usage`. */
export function withPoolUsage<T>(usage: PoolUsage, work: () => Promise<T>): Promise<T> {
  return current.run(usage, work);
}

const waitSeconds = () =>
  histogram(
    "db_client_connection_wait_seconds",
    "Time a checkout waited for a pooled connection (OTel db.client.connection.wait_time)",
    WAIT_BUCKETS,
  );
const useSeconds = () =>
  histogram(
    "db_client_connection_use_seconds",
    "How long a checked-out connection was held: query or transaction time (OTel db.client.connection.use_time)",
  );

const poolsHolder = globalThis as unknown as { __serenePools?: Map<string, pg.Pool> };

/** Exposes a pool's size as gauges under `pool="<name>"` (no host, no credentials). */
export function registerPool(name: string, pool: pg.Pool): void {
  poolsHolder.__serenePools ??= new Map();
  poolsHolder.__serenePools.set(name, pool);
  const pools = poolsHolder.__serenePools;
  gauge(
    "db_client_connection_count",
    "Connections per pool by state (OTel db.client.connection.count)",
    () =>
      [...pools].flatMap(([pool, p]) => [
        { labels: { pool, state: "used" }, value: p.totalCount - p.idleCount },
        { labels: { pool, state: "idle" }, value: p.idleCount },
      ]),
  );
  gauge("db_client_connection_max", "Configured pool maximum", () =>
    [...pools].map(([pool, p]) => ({ labels: { pool }, value: p.options.max ?? 10 })),
  );
  gauge(
    "db_client_connection_pending_requests",
    "Checkouts waiting for a connection: the pool is saturated while above 0",
    () => [...pools].map(([pool, p]) => ({ labels: { pool }, value: p.waitingCount })),
  );
}

/** Stops reporting a pool (a closed replica pool). */
export function unregisterPool(name: string): void {
  poolsHolder.__serenePools?.delete(name);
}

/**
 * Measures every checkout. The adapter checks out through `pool.connect`
 * (transactions) and `pool.query` (which calls `connect` with a callback),
 * so both paths are measured. pg-pool assigns `client.release` per checkout,
 * before handing the client out, so it is wrapped here for the hold time.
 */
export function instrumentPool(pool: pg.Pool, name: string): void {
  const connect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  // Connections the pool has just opened, counted when first handed out (the
  // pool's own "connect" event does not run in the request's context).
  const fresh = new WeakSet<object>();
  pool.on("connect", (client) => fresh.add(client));
  const labels = { pool: name };
  const done = (usage: PoolUsage | undefined, started: number, client: unknown) => {
    const acquired = performance.now();
    waitSeconds().observe(labels, (acquired - started) / 1000);
    if (client && typeof client === "object") {
      const checkedOut = client as pg.PoolClient;
      const release = checkedOut.release;
      if (typeof release === "function") {
        checkedOut.release = ((...args: Parameters<typeof release>) => {
          useSeconds().observe(labels, (performance.now() - acquired) / 1000);
          return release.apply(checkedOut, args);
        }) as typeof release;
      }
    }
    if (!usage) return;
    usage.waitMs += acquired - started;
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
        if (!args[0]) done(usage, started, args[1]);
        callback(...args);
      });
    }
    return (connect() as Promise<pg.PoolClient>).then((client) => {
      done(usage, started, client);
      return client;
    });
  }) as typeof pool.connect;
}
