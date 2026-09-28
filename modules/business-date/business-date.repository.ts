import "server-only";
import type { Tx } from "@/lib/db/prisma";

export function findCurrentBusinessDate(tx: Tx, propertyId: string) {
  return tx.businessDate.findFirst({
    where: { propertyId, isCurrent: true },
    select: { id: true, date: true, status: true },
  });
}

/** Current business dates of many properties in one read (organization overview, M9). */
export function findCurrentBusinessDates(tx: Tx, propertyIds: string[]) {
  return tx.businessDate.findMany({
    where: { propertyId: { in: propertyIds }, isCurrent: true },
    select: { propertyId: true, id: true, date: true, status: true },
  });
}

export function countBusinessDates(tx: Tx, propertyId: string) {
  return tx.businessDate.count({ where: { propertyId } });
}

export function insertBusinessDate(tx: Tx, propertyId: string, date: Date) {
  return tx.businessDate.create({
    data: { propertyId, date, status: "OPEN", isCurrent: true },
    select: { id: true, date: true, status: true },
  });
}

/**
 * Current business date row locked FOR SHARE: concurrent postings may proceed
 * together, but night audit (FOR UPDATE) waits until they commit, and they
 * wait while it runs (docs/ARCHITECTURE.md §5 lock order, step 1).
 */
export async function lockCurrentBusinessDateForShare(tx: Tx, propertyId: string) {
  const rows = await tx.$queryRaw<{ date: Date; status: string }[]>`
    SELECT "date", "status"::text AS "status"
    FROM "business_dates"
    WHERE "property_id" = ${propertyId}::uuid AND "is_current"
    FOR SHARE`;
  return rows[0] ?? null;
}
