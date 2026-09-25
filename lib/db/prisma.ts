import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";

/**
 * Single PrismaClient per server process. In development the instance is
 * cached on globalThis so hot reload does not exhaust database connections.
 */
function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: serverEnv().DATABASE_URL,
    // Every session runs in UTC (ARCHITECTURE D29). @prisma/adapter-pg sends
    // Dates as offset-less UTC wall-clock text and re-labels timestamptz read
    // back as +00:00, so any other session zone (a server default such as
    // Asia/Karachi) stores instants shifted by the zone offset and makes
    // app-written values disagree with SQL now(). Property-local dates and
    // times are computed from the property's own time zone, never the session's.
    options: "-c TimeZone=UTC",
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = typeof prisma;
/** Interactive-transaction client passed through service and repository calls. */
export type Tx = Prisma.TransactionClient;
