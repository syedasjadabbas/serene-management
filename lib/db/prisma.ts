import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";

/**
 * Single PrismaClient per server process. In development the instance is
 * cached on globalThis so hot reload does not exhaust database connections.
 */
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: serverEnv().DATABASE_URL });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = typeof prisma;
/** Interactive-transaction client passed through service and repository calls. */
export type Tx = Prisma.TransactionClient;
