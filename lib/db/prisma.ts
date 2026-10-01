import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";
import { pgPoolConfig } from "./pool-config";
import { instrumentPool } from "./pool-metrics";

/**
 * Single PrismaClient per server process. In development the instance is
 * cached on globalThis so hot reload does not exhaust database connections.
 */
function createPrismaClient() {
  const env = serverEnv();
  // Pool size, timeouts, lifetime and the UTC session zone (D29, D52, D64):
  // lib/db/pool-config.ts. The pool is created here (not by the adapter) so
  // its checkouts can be measured for the opt-in Server-Timing header.
  const pool = new pg.Pool(pgPoolConfig(env));
  if (env.SERVER_TIMING === "1") instrumentPool(pool);
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = typeof prisma;
/** Interactive-transaction client passed through service and repository calls. */
export type Tx = Prisma.TransactionClient;
