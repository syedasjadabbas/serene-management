import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

export const guestSummarySelect = {
  id: true,
  profileNumber: true,
  title: true,
  firstName: true,
  lastName: true,
  primaryEmail: true,
  primaryPhone: true,
  nationalityCode: true,
  isRestricted: true,
  vipLevel: { select: { code: true, name: true } },
} as const satisfies Prisma.GuestSelect;

export type GuestSummaryRow = Prisma.GuestGetPayload<{ select: typeof guestSummarySelect }>;

const activeProfile = { status: "ACTIVE", deletedAt: null } as const;

/**
 * Organization-scoped guest search: normalized name words (trigram GIN index
 * on search_name), exact email, phone fragment or exact profile number.
 * Always bounded by `limit`.
 */
export function searchGuests(
  tx: Tx,
  organizationId: string,
  terms: { nameTokens: string[]; raw: string; digits: string },
  limit: number,
) {
  // Every name word must appear, in any order ("sofia ros" finds "rossi sofia").
  const or: Prisma.GuestWhereInput[] = [];
  if (terms.nameTokens.length > 0) {
    or.push({ AND: terms.nameTokens.map((token) => ({ searchName: { contains: token } })) });
  }
  if (terms.raw.includes("@")) or.push({ primaryEmail: terms.raw.toLowerCase() });
  if (terms.digits.length >= 4) or.push({ primaryPhone: { contains: terms.digits } });
  or.push({ profileNumber: terms.raw.toUpperCase() });
  return tx.guest.findMany({
    where: { organizationId, ...activeProfile, OR: or },
    select: guestSummarySelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: limit,
  });
}

export function findGuest(tx: Tx, organizationId: string, guestId: string) {
  return tx.guest.findFirst({
    where: { id: guestId, organizationId, ...activeProfile },
    select: guestSummarySelect,
  });
}

export function insertGuest(tx: Tx, data: Prisma.GuestUncheckedCreateInput) {
  return tx.guest.create({ data, select: guestSummarySelect });
}

export function profileNumberExists(tx: Tx, organizationId: string, profileNumber: string) {
  return tx.guest.count({ where: { organizationId, profileNumber } });
}
