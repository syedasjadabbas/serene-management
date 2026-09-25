import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

const MANAGED_TYPES = ["COMPANY", "TRAVEL_AGENT"] as const;

/** Keyset page of accounts on (name, id); name words use the trigram index on search_name. */
export function findAccountsPage(
  tx: Tx,
  organizationId: string,
  filters: { q?: string; type?: string; status: "ACTIVE" | "INACTIVE" },
  after: { name: string; id: string } | null,
  limit: number,
) {
  const and: Prisma.AccountProfileWhereInput[] = [
    {
      organizationId,
      deletedAt: null,
      status: filters.status,
      type: filters.type ? (filters.type as "COMPANY") : { in: [...MANAGED_TYPES] },
    },
  ];
  if (filters.q) {
    const words = filters.q.split(" ").filter(Boolean).slice(0, 5);
    and.push({
      OR: [
        { AND: words.map((w) => ({ searchName: { contains: w } })) },
        { code: filters.q.toUpperCase() },
      ],
    });
  }
  if (after) {
    and.push({
      OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }],
    });
  }
  return tx.accountProfile.findMany({
    where: { AND: and },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      type: true,
      code: true,
      name: true,
      city: true,
      countryCode: true,
      status: true,
      isRestricted: true,
      _count: { select: { contacts: true } },
    },
  });
}

export function findAccount(tx: Tx, organizationId: string, id: string) {
  return tx.accountProfile.findFirst({
    where: { id, organizationId, deletedAt: null, status: { in: ["ACTIVE", "INACTIVE"] } },
    select: {
      id: true,
      version: true,
      type: true,
      code: true,
      name: true,
      legalName: true,
      iataNumber: true,
      taxId: true,
      email: true,
      phone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      region: true,
      postalCode: true,
      countryCode: true,
      notes: true,
      status: true,
      isRestricted: true,
      restrictionReason: true,
      createdAt: true,
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { guest: { lastName: "asc" } }],
        select: {
          kind: true,
          role: true,
          isPrimary: true,
          guest: {
            select: {
              id: true,
              profileNumber: true,
              title: true,
              firstName: true,
              lastName: true,
              primaryEmail: true,
            },
          },
        },
      },
    },
  });
}

export type AccountRow = NonNullable<Awaited<ReturnType<typeof findAccount>>>;

/** Account usable on a reservation: active company of the organization. */
export function findBookableAccount(tx: Tx, organizationId: string, id: string) {
  return tx.accountProfile.findFirst({
    where: { id, organizationId, deletedAt: null, status: "ACTIVE", type: "COMPANY" },
    select: { id: true, code: true, name: true, isRestricted: true },
  });
}

export async function lockAccount(tx: Tx, organizationId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string; version: number; type: string }[]>`
    SELECT "id", "version", "type"::text AS "type" FROM "account_profiles"
    WHERE "id" = ${id}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL AND "status" IN ('ACTIVE', 'INACTIVE')
    FOR UPDATE`;
  return rows[0] ?? null;
}

export function accountCodeTaken(tx: Tx, organizationId: string, type: string, code: string) {
  return tx.accountProfile.count({
    where: { organizationId, type: type as "COMPANY", code },
  });
}

export function insertAccount(tx: Tx, data: Prisma.AccountProfileUncheckedCreateInput) {
  return tx.accountProfile.create({ data, select: { id: true } });
}

export function updateAccountVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.AccountProfileUncheckedUpdateManyInput,
) {
  return tx.accountProfile.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

export function findContact(tx: Tx, accountId: string, guestId: string) {
  return tx.accountContact.findUnique({
    where: { accountProfileId_guestId: { accountProfileId: accountId, guestId } },
    select: { kind: true, role: true, isPrimary: true },
  });
}

export async function upsertContact(
  tx: Tx,
  accountId: string,
  guestId: string,
  data: { kind: "EMPLOYEE" | "CONTACT" | "ASSOCIATE"; role: string | null; isPrimary: boolean },
) {
  // The partial unique index allows one primary per account: demote first.
  if (data.isPrimary) {
    await tx.accountContact.updateMany({
      where: { accountProfileId: accountId, isPrimary: true, NOT: { guestId } },
      data: { isPrimary: false },
    });
  }
  // Callers hold the account row lock, so find-then-write cannot race. (A
  // native upsert would target the partial primary-contact index instead of
  // the key.)
  const key = { accountProfileId_guestId: { accountProfileId: accountId, guestId } };
  if (await tx.accountContact.findUnique({ where: key, select: { guestId: true } })) {
    await tx.accountContact.update({ where: key, data });
  } else {
    await tx.accountContact.create({ data: { accountProfileId: accountId, guestId, ...data } });
  }
}

export function deleteContact(tx: Tx, accountId: string, guestId: string) {
  return tx.accountContact.deleteMany({ where: { accountProfileId: accountId, guestId } });
}

export function isAccountContact(tx: Tx, accountId: string, guestId: string) {
  return tx.accountContact.count({ where: { accountProfileId: accountId, guestId } });
}

export function findAccountReservations(tx: Tx, accountId: string, propertyIds: string[]) {
  if (propertyIds.length === 0) return Promise.resolve([]);
  return tx.reservationRoom.findMany({
    where: { propertyId: { in: propertyIds }, reservation: { companyId: accountId } },
    orderBy: [{ arrivalDate: "desc" }, { id: "desc" }],
    take: 25,
    select: {
      reservationId: true,
      lineNumber: true,
      status: true,
      arrivalDate: true,
      departureDate: true,
      propertyId: true,
      reservation: {
        select: { confirmationNumber: true, _count: { select: { rooms: true } } },
      },
      primaryGuest: { select: { title: true, firstName: true, lastName: true } },
      ratePlan: { select: { code: true } },
    },
  });
}

export function findAccountNegotiatedRates(tx: Tx, accountId: string, propertyIds: string[]) {
  if (propertyIds.length === 0) return Promise.resolve([]);
  return tx.negotiatedRate.findMany({
    where: { accountProfileId: accountId, propertyId: { in: propertyIds } },
    orderBy: [{ propertyId: "asc" }, { createdAt: "asc" }],
    select: {
      validFrom: true,
      validTo: true,
      ratePlan: {
        select: {
          id: true,
          code: true,
          name: true,
          property: { select: { id: true, code: true } },
        },
      },
    },
  });
}
