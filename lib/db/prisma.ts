import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";
import { onShutdown } from "@/lib/lifecycle/shutdown";
import { pgPoolConfig } from "./pool-config";
import { instrumentPool } from "./pool-metrics";

/**
 * One PrismaClient per server bundle. In development the instance is cached on
 * globalThis so hot reload does not exhaust database connections.
 *
 * In production the instrumentation bundle (inline job worker) and the route
 * bundles each load this module, so a process can hold two pools of up to
 * DATABASE_POOL_MAX connections (connectionBudget in ./pool-config). They are
 * deliberately not shared: each bundle checks errors with `instanceof` against
 * its own copy of the Prisma error classes. Every client closes its own pool
 * on shutdown (lib/lifecycle/shutdown.ts).
 */
function createPrismaClient() {
  const env = serverEnv();
  // Pool size, timeouts, lifetime and the UTC session zone (D29, D52, D64):
  // lib/db/pool-config.ts. The pool is created here (not by the adapter) so
  // its checkouts can be measured for the opt-in Server-Timing header.
  const pool = new pg.Pool(pgPoolConfig(env));
  if (env.SERVER_TIMING === "1") instrumentPool(pool);
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  const client = new PrismaClient({ adapter });
  const count = globalThis as unknown as { __serenePrismaClients?: number };
  count.__serenePrismaClients = (count.__serenePrismaClients ?? 0) + 1;
  onShutdown(`database pool ${count.__serenePrismaClients}`, "close", () => client.$disconnect());
  return client;
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = typeof prisma;
/** Interactive-transaction client passed through service and repository calls. */
export type Tx = Prisma.TransactionClient;
