import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";
import { onShutdown } from "@/lib/lifecycle/shutdown";
import { pgPoolConfig } from "./pool-config";
import { instrumentPool, registerPool } from "./pool-metrics";

/**
 * One PostgreSQL pool per process, one PrismaClient per server bundle.
 *
 * In production a process loads this module several times: the route
 * handlers, the server-rendered pages and the instrumentation bundle (inline
 * job worker) are separate bundles (measured: three). Each gets its own
 * PrismaClient, deliberately: each bundle checks errors with `instanceof`
 * against its own copy of the Prisma error classes. They all share the one
 * pg.Pool kept on globalThis (`pg` is an external package: one copy per
 * process), so a process holds at most DATABASE_POOL_MAX pooled connections
 * (connectionBudget in ./pool-config).
 *
 * The pool closes once, on shutdown (lib/lifecycle/shutdown.ts), or when the
 * client that created it disconnects (operational commands, tests: one bundle).
 * In development the client is also cached so hot reload does not reconnect.
 */
const poolHolder = globalThis as unknown as { __serenePrimaryPool?: pg.Pool };

function createPrismaClient() {
  const env = serverEnv();
  const created = !poolHolder.__serenePrimaryPool;
  if (created) {
    // Pool size, timeouts, lifetime and the UTC session zone (D29, D52, D64):
    // lib/db/pool-config.ts. Created here (not by the adapter) so its
    // checkouts can be measured (metrics, slow-request log, Server-Timing).
    const pool = new pg.Pool(pgPoolConfig(env));
    instrumentPool(pool, "primary");
    registerPool("primary", pool);
    poolHolder.__serenePrimaryPool = pool;
    onShutdown("database pool", "close", () => pool.end().catch(() => undefined));
  }
  const adapter = new PrismaPg(poolHolder.__serenePrimaryPool!, { disposeExternalPool: created });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = typeof prisma;
/** Interactive-transaction client passed through service and repository calls. */
export type Tx = Prisma.TransactionClient;
