import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

export function findPrograms(tx: Tx, organizationId: string) {
  return tx.loyaltyProgram.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      isExternal: true,
      status: true,
      _count: { select: { memberships: true } },
      tiers: {
        orderBy: [{ rank: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          rank: true,
          qualifyingNights: true,
          qualifyingStays: true,
          status: true,
          _count: { select: { memberships: true } },
        },
      },
    },
  });
}

export function findProgram(tx: Tx, organizationId: string, id: string) {
  return tx.loyaltyProgram.findFirst({
    where: { id, organizationId },
    select: { id: true, code: true, name: true, isExternal: true, status: true },
  });
}

export function programCodeTaken(tx: Tx, organizationId: string, code: string) {
  return tx.loyaltyProgram.count({ where: { organizationId, code } });
}

export function insertProgram(tx: Tx, data: Prisma.LoyaltyProgramUncheckedCreateInput) {
  return tx.loyaltyProgram.create({ data, select: { id: true } });
}

export function updateProgramRow(tx: Tx, id: string, data: Prisma.LoyaltyProgramUpdateInput) {
  return tx.loyaltyProgram.update({ where: { id }, data });
}

export function findTier(tx: Tx, organizationId: string, id: string) {
  return tx.loyaltyTier.findFirst({
    where: { id, program: { organizationId } },
    select: {
      id: true,
      programId: true,
      code: true,
      name: true,
      rank: true,
      qualifyingNights: true,
      qualifyingStays: true,
      status: true,
    },
  });
}

export function tierCodeTaken(tx: Tx, programId: string, code: string) {
  return tx.loyaltyTier.count({ where: { programId, code } });
}

export function insertTier(tx: Tx, data: Prisma.LoyaltyTierUncheckedCreateInput) {
  return tx.loyaltyTier.create({ data, select: { id: true } });
}

export function updateTierRow(tx: Tx, id: string, data: Prisma.LoyaltyTierUpdateInput) {
  return tx.loyaltyTier.update({ where: { id }, data });
}

export function findMembershipOfGuest(tx: Tx, programId: string, guestId: string) {
  return tx.loyaltyMembership.findUnique({
    where: { programId_guestId: { programId, guestId } },
    select: { id: true, status: true },
  });
}

export function membershipNumberTaken(tx: Tx, programId: string, number: string) {
  return tx.loyaltyMembership.count({ where: { programId, membershipNumber: number } });
}

export function insertMembership(tx: Tx, data: Prisma.LoyaltyMembershipUncheckedCreateInput) {
  return tx.loyaltyMembership.create({ data, select: { id: true } });
}

/** Locks a membership of the organization (FOR UPDATE) with what a command needs. */
export async function lockMembership(tx: Tx, organizationId: string, id: string) {
  const rows = await tx.$queryRaw<
    {
      id: string;
      program_id: string;
      guest_id: string;
      tier_id: string | null;
      status: "ACTIVE" | "INACTIVE";
      points_balance: string;
      version: number;
    }[]
  >`
    SELECT m."id", m."program_id", m."guest_id", m."tier_id", m."status"::text AS "status",
           m."points_balance"::text AS "points_balance", m."version"
    FROM "loyalty_memberships" m
    JOIN "loyalty_programs" p ON p."id" = m."program_id"
    WHERE m."id" = ${id}::uuid AND p."organization_id" = ${organizationId}::uuid
    FOR UPDATE OF m`;
  return rows[0] ?? null;
}

export function updateMembershipVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.LoyaltyMembershipUncheckedUpdateManyInput,
) {
  return tx.loyaltyMembership.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

export function insertChange(tx: Tx, data: Prisma.LoyaltyMembershipChangeUncheckedCreateInput) {
  return tx.loyaltyMembershipChange.create({ data, select: { id: true } });
}

export function insertTransaction(tx: Tx, data: Prisma.LoyaltyTransactionUncheckedCreateInput) {
  return tx.loyaltyTransaction.create({ data, select: { id: true } });
}

export function findMembersPage(
  tx: Tx,
  programId: string,
  after: { enrolledAt: Date; id: string } | null,
  limit: number,
) {
  return tx.loyaltyMembership.findMany({
    where: {
      programId,
      ...(after
        ? {
            OR: [
              { enrolledAt: { lt: after.enrolledAt } },
              { enrolledAt: after.enrolledAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ enrolledAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      membershipNumber: true,
      status: true,
      pointsBalance: true,
      enrolledAt: true,
      tier: { select: { name: true } },
      guest: {
        select: { id: true, profileNumber: true, title: true, firstName: true, lastName: true },
      },
    },
  });
}
