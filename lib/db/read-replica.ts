import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";
import { pgPoolConfig } from "./pool-config";
import { currentPoolUsage } from "./pool-metrics";
import { type Db, prisma } from "./prisma";
import { databaseErrorCode, isConnectionError } from "./transaction";

/**
 * Optional read replica (scalability phase 7, docs/SCALABILITY.md §35,
 * ARCHITECTURE D67). Nothing goes to it implicitly: a service hands one
 * explicitly approved, staleness-tolerant read to `readFromReplica`, which runs
 * it on the replica when one is configured (READ_DATABASE_URL), reachable and
 * within READ_REPLICA_MAX_LAG_MS of the primary, and on the primary otherwise.
 *
 * - Without READ_DATABASE_URL every read runs on the primary, exactly as before.
 * - Health is checked at most every 10 s (`pg_is_in_recovery`, WAL receive vs
 *   replay position, last replay timestamp) and on demand after an error.
 * - A replica connection error, a recovery conflict (40001) or "too many
 *   connections" marks it unhealthy and the same read is run on the primary.
 * - Writes, transactions, locks, sessions, rate limits, jobs and every
 *   consistency-sensitive read never come here: they use `prisma` directly.
 */

export type ReadRoute = "primary" | "replica" | "fallback";

export interface ReplicaHealth {
  healthy: boolean;
  /** Replay lag in ms (0 when caught up or when the endpoint is not a standby). */
  lagMs: number | null;
  standby: boolean | null;
  checkedAt: number;
  reason: string | null;
}

/** Test seam: replaces the health probe (lag and failure scenarios). */
export type HealthProbe = (db: Db) => Promise<{ standby: boolean; lagMs: number }>;

const CHECK_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_000;
const FALLBACK_SQLSTATES = new Set(["40001", "53300"]);

interface ReplicaState {
  client: Db;
  pool: pg.Pool;
  maxLagMs: number;
  health: ReplicaHealth;
  probing: Promise<void> | null;
  probe: HealthProbe;
}

const holder = globalThis as unknown as { __sereneReadReplica?: ReplicaState | null };

const defaultProbe: HealthProbe = async (db) => {
  const rows = await db.$queryRaw<{ standby: boolean; lag_ms: number | null }[]>`
    SELECT pg_is_in_recovery() AS "standby",
           CASE WHEN NOT pg_is_in_recovery() THEN 0
                WHEN pg_last_wal_receive_lsn() IS NOT DISTINCT FROM pg_last_wal_replay_lsn() THEN 0
                ELSE EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()) * 1000
           END::float8 AS "lag_ms"`;
  const row = rows[0]!;
  return { standby: row.standby, lagMs: row.lag_ms ?? Number.POSITIVE_INFINITY };
};

function createState(
  url: string,
  options: { poolMax: number; maxLagMs: number; probe?: HealthProbe; onAcquire?: () => void },
): ReplicaState {
  const env = serverEnv();
  const pool = new pg.Pool({
    ...pgPoolConfig({
      ...env,
      DATABASE_URL: url,
      DATABASE_POOL_MAX: options.poolMax,
      DATABASE_POOL_MIN: 0,
    }),
    application_name: "serene-management-read",
  });
  // A replica that drops connections must not crash the process.
  pool.on("error", () => undefined);
  if (options.onAcquire) pool.on("acquire", options.onAcquire);
  const client = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
  }) as unknown as Db;
  return {
    client,
    pool,
    maxLagMs: options.maxLagMs,
    health: { healthy: false, lagMs: null, standby: null, checkedAt: 0, reason: "not checked" },
    probing: null,
    probe: options.probe ?? defaultProbe,
  };
}

function state(): ReplicaState | null {
  if (holder.__sereneReadReplica !== undefined) return holder.__sereneReadReplica;
  const env = serverEnv();
  holder.__sereneReadReplica = env.READ_DATABASE_URL
    ? createState(env.READ_DATABASE_URL, {
        poolMax: env.READ_DATABASE_POOL_MAX,
        maxLagMs: env.READ_REPLICA_MAX_LAG_MS,
      })
    : null;
  return holder.__sereneReadReplica;
}

/**
 * Test and operations seam: (re)configures the replica (null: none). Closes a
 * previous replica pool.
 */
export async function configureReadReplica(
  config: {
    url: string;
    poolMax?: number;
    maxLagMs?: number;
    probe?: HealthProbe;
    /** Called on every connection checkout from the replica pool (tests). */
    onAcquire?: () => void;
  } | null,
): Promise<void> {
  const previous = holder.__sereneReadReplica;
  holder.__sereneReadReplica = config
    ? createState(config.url, {
        poolMax: config.poolMax ?? 2,
        maxLagMs: config.maxLagMs ?? 30_000,
        probe: config.probe,
        onAcquire: config.onAcquire,
      })
    : null;
  await previous?.client.$disconnect().catch(() => undefined);
}

async function checkHealth(replica: ReplicaState): Promise<void> {
  const now = Date.now();
  try {
    const result = await Promise.race([
      replica.probe(replica.client),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("replica health probe timed out")), PROBE_TIMEOUT_MS),
      ),
    ]);
    const healthy = result.lagMs <= replica.maxLagMs;
    replica.health = {
      healthy,
      lagMs: Number.isFinite(result.lagMs) ? Math.round(result.lagMs) : null,
      standby: result.standby,
      checkedAt: now,
      reason: healthy ? null : "lag above READ_REPLICA_MAX_LAG_MS",
    };
  } catch {
    replica.health = {
      healthy: false,
      lagMs: null,
      standby: null,
      checkedAt: now,
      reason: "unreachable",
    };
  }
}

async function freshHealth(replica: ReplicaState): Promise<ReplicaHealth> {
  if (Date.now() - replica.health.checkedAt >= CHECK_INTERVAL_MS) {
    replica.probing ??= checkHealth(replica).finally(() => {
      replica.probing = null;
    });
    await replica.probing;
  }
  return replica.health;
}

/** Current replica status for operators (`npm run ops:db-check`), without connection details. */
export async function readReplicaStatus(): Promise<
  ({ configured: true } & ReplicaHealth) | { configured: false }
> {
  const replica = state();
  if (!replica) return { configured: false };
  replica.health.checkedAt = 0;
  return { configured: true, ...(await freshHealth(replica)) };
}

function shouldFallBack(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return isConnectionError(error) || (code !== undefined && FALLBACK_SQLSTATES.has(code));
}

function noteRoute(route: ReadRoute) {
  const usage = currentPoolUsage();
  if (usage) usage.reads[route] = (usage.reads[route] ?? 0) + 1;
}

/**
 * Runs an approved, staleness-tolerant read (`eligible`) on the replica when
 * possible, otherwise on the primary. `work` must only read, without locks or
 * session state; it may run twice (replica, then primary) and must not have
 * side effects. Authorization is the caller's, before this call: the replica
 * only runs the same property-scoped queries the primary would.
 */
export async function readFromReplica<T>(
  eligible: boolean,
  work: (db: Db) => Promise<T>,
): Promise<{ value: T; route: ReadRoute }> {
  const replica = eligible ? state() : null;
  if (!replica) {
    noteRoute("primary");
    return { value: await work(prisma), route: "primary" };
  }
  const health = await freshHealth(replica);
  if (!health.healthy) {
    noteRoute("fallback");
    return { value: await work(prisma), route: "fallback" };
  }
  try {
    const value = await work(replica.client);
    noteRoute("replica");
    return { value, route: "replica" };
  } catch (error) {
    if (!shouldFallBack(error)) throw error;
    // Re-checked after the normal interval, so a dead replica costs one failed attempt per 10 s.
    replica.health = { ...replica.health, healthy: false, checkedAt: Date.now(), reason: "error" };
    noteRoute("fallback");
    return { value: await work(prisma), route: "fallback" };
  }
}
