import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";
import { pgPoolConfig } from "./pool-config";

/**
 * Single PrismaClient per server process. In development the instance is
 * cached on globalThis so hot reload does not exhaust database connections.
 */
function createPrismaClient() {
  // Pool size, timeouts and the UTC session zone (D29, D52): lib/db/pool-config.ts.
  const adapter = new PrismaPg(pgPoolConfig(serverEnv()));
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = typeof prisma;
/** Interactive-transaction client passed through service and repository calls. */
export type Tx = Prisma.TransactionClient;
