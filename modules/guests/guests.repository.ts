import "server-only";
import { Prisma } from "@/generated/prisma/client";
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

export interface GuestSearchTerms {
  nameTokens: string[];
  raw: string;
  digits: string;
  /** Guests of reservations whose confirmation number matched (readable properties only). */
  confirmationGuestIds: string[];
}

/**
 * Organization-scoped guest search / list, keyset-paginated on
 * (last name, first name, id). Name words use the trigram index on
 * search_name (every word must appear, any order); e-mail is exact (primary
 * or any listed e-mail); phone digits use the trigram index on phone_digits.
 */
export function searchGuests(
  tx: Tx,
  organizationId: string,
  status: "ACTIVE" | "INACTIVE",
  terms: GuestSearchTerms | null,
  after: { lastName: string; firstName: string; id: string } | null,
  limit: number,
) {
  const and: Prisma.GuestWhereInput[] = [{ organizationId, status, deletedAt: null }];
  if (terms) {
    const or: Prisma.GuestWhereInput[] = [];
    if (terms.nameTokens.length > 0) {
      or.push({ AND: terms.nameTokens.map((token) => ({ searchName: { contains: token } })) });
    }
    if (terms.raw.includes("@")) {
      const email = terms.raw.toLowerCase();
      or.push({ primaryEmail: email });
      or.push({ contacts: { some: { type: "EMAIL", value: email } } });
    }
    if (terms.digits.length >= 4) or.push({ phoneDigits: { contains: terms.digits } });
    or.push({ profileNumber: terms.raw.toUpperCase() });
    if (terms.confirmationGuestIds.length > 0) or.push({ id: { in: terms.confirmationGuestIds } });
    and.push({ OR: or });
  }
  if (after) {
    and.push({
      OR: [
        { lastName: { gt: after.lastName } },
        { lastName: after.lastName, firstName: { gt: after.firstName } },
        { lastName: after.lastName, firstName: after.firstName, id: { gt: after.id } },
      ],
    });
  }
  return tx.guest.findMany({
    where: { AND: and },
    select: guestSummarySelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: limit,
  });
}

/** Primary / listed guests of reservations with this confirmation number. */
export async function findGuestIdsByConfirmation(
  tx: Tx,
  propertyIds: string[],
  confirmationNumber: string,
): Promise<string[]> {
  if (propertyIds.length === 0) return [];
  const rows = await tx.reservationRoom.findMany({
    where: {
      propertyId: { in: propertyIds },
      reservation: { confirmationNumber },
    },
    select: { primaryGuestId: true, guests: { select: { guestId: true } } },
    take: 20,
  });
  return [...new Set(rows.flatMap((r) => [r.primaryGuestId, ...r.guests.map((g) => g.guestId)]))];
}

export function findGuest(tx: Tx, organizationId: string, guestId: string) {
  return tx.guest.findFirst({
    where: { id: guestId, organizationId, ...activeProfile },
    select: guestSummarySelect,
  });
}

/** Any status except merged / anonymized / deleted (the profile page shows inactive ones). */
export function findGuestAnyStatus(tx: Tx, organizationId: string, guestId: string) {
  return tx.guest.findFirst({
    where: { id: guestId, organizationId, deletedAt: null, status: { in: ["ACTIVE", "INACTIVE"] } },
    select: { id: true },
  });
}

/** Locks the guest row for a profile command (version check follows). */
export async function lockGuest(tx: Tx, organizationId: string, guestId: string) {
  const rows = await tx.$queryRaw<{ id: string; version: number; status: string }[]>`
    SELECT "id", "version", "status"::text AS "status" FROM "guests"
    WHERE "id" = ${guestId}::uuid AND "organization_id" = ${organizationId}::uuid
      AND "deleted_at" IS NULL AND "status" IN ('ACTIVE', 'INACTIVE')
    FOR UPDATE`;
  return rows[0] ?? null;
}

export function insertGuest(tx: Tx, data: Prisma.GuestUncheckedCreateInput) {
  return tx.guest.create({ data, select: guestSummarySelect });
}

export function profileNumberExists(tx: Tx, organizationId: string, profileNumber: string) {
  return tx.guest.count({ where: { organizationId, profileNumber } });
}

/** Active profiles sharing an e-mail or phone (duplicate warning on create). */
export function findPossibleDuplicates(
  tx: Tx,
  organizationId: string,
  email: string | null,
  digits: string | null,
) {
  const or: Prisma.GuestWhereInput[] = [];
  if (email)
    or.push({ primaryEmail: email }, { contacts: { some: { type: "EMAIL", value: email } } });
  if (digits && digits.length >= 6) or.push({ phoneDigits: digits });
  if (or.length === 0) return Promise.resolve([]);
  return tx.guest.findMany({
    where: { organizationId, ...activeProfile, OR: or },
    select: guestSummarySelect,
    orderBy: { id: "asc" },
    take: 5,
  });
}

export const guestProfileSelect = {
  ...guestSummarySelect,
  version: true,
  status: true,
  middleName: true,
  preferredName: true,
  gender: true,
  dateOfBirth: true,
  languageCode: true,
  preferredContact: true,
  marketingOptIn: true,
  restrictionReason: true,
  vipLevelId: true,
  createdAt: true,
  updatedAt: true,
  contacts: {
    orderBy: [{ type: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, type: true, value: true, isPrimary: true, optIn: true },
  },
  addresses: {
    orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
    select: {
      id: true,
      type: true,
      line1: true,
      line2: true,
      city: true,
      region: true,
      postalCode: true,
      countryCode: true,
      isPrimary: true,
    },
  },
  preferences: {
    orderBy: [{ preferenceCode: { groupCode: "asc" } }, { preferenceCode: { code: "asc" } }],
    select: {
      id: true,
      propertyId: true,
      note: true,
      preferenceCode: { select: { id: true, code: true, name: true, groupCode: true } },
      property: { select: { id: true, code: true } },
    },
  },
  notes: {
    where: { deletedAt: null },
    orderBy: [{ isAlert: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      body: true,
      visibility: true,
      isAlert: true,
      propertyId: true,
      createdById: true,
      createdAt: true,
      property: { select: { id: true, code: true } },
    },
  },
  accountContacts: {
    orderBy: { account: { name: "asc" } },
    select: {
      kind: true,
      role: true,
      isPrimary: true,
      account: { select: { id: true, code: true, name: true, type: true, status: true } },
    },
  },
  loyaltyMemberships: {
    orderBy: { enrolledAt: "asc" },
    select: {
      id: true,
      version: true,
      membershipNumber: true,
      status: true,
      pointsBalance: true,
      enrolledAt: true,
      program: { select: { id: true, code: true, name: true } },
      tier: { select: { id: true, code: true, name: true, rank: true } },
      changes: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          createdById: true,
          createdAt: true,
          fromTier: { select: { name: true } },
          toTier: { select: { name: true } },
        },
      },
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, type: true, points: true, description: true, createdAt: true },
      },
    },
  },
} as const satisfies Prisma.GuestSelect;

export type GuestProfileRow = Prisma.GuestGetPayload<{ select: typeof guestProfileSelect }>;

export function findGuestProfile(tx: Tx, organizationId: string, guestId: string) {
  return tx.guest.findFirst({
    where: { id: guestId, organizationId, deletedAt: null, status: { in: ["ACTIVE", "INACTIVE"] } },
    select: guestProfileSelect,
  });
}

export function findUserNames(tx: Tx, organizationId: string, ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.user.findMany({
    where: { organizationId, id: { in: [...new Set(ids)] } },
    select: { id: true, displayName: true },
  });
}

export function updateGuestVersioned(
  tx: Tx,
  guestId: string,
  version: number,
  data: Prisma.GuestUncheckedUpdateManyInput,
) {
  return tx.guest.updateMany({
    where: { id: guestId, version },
    data: { ...data, version: { increment: 1 } },
  });
}

export function bumpGuestVersion(tx: Tx, guestId: string, version: number) {
  return updateGuestVersioned(tx, guestId, version, {});
}

export async function replaceContacts(
  tx: Tx,
  guestId: string,
  contacts: {
    type: Prisma.GuestContactCreateManyInput["type"];
    value: string;
    isPrimary: boolean;
    optIn: boolean;
  }[],
) {
  await tx.guestContact.deleteMany({ where: { guestId } });
  if (contacts.length > 0) {
    await tx.guestContact.createMany({ data: contacts.map((c) => ({ ...c, guestId })) });
  }
}

export async function replaceAddresses(
  tx: Tx,
  guestId: string,
  addresses: Omit<Prisma.GuestAddressCreateManyInput, "guestId" | "id">[],
) {
  await tx.guestAddress.deleteMany({ where: { guestId } });
  if (addresses.length > 0) {
    await tx.guestAddress.createMany({ data: addresses.map((a) => ({ ...a, guestId })) });
  }
}

export function findVipLevel(tx: Tx, organizationId: string, id: string) {
  return tx.vipLevel.findFirst({
    where: { id, organizationId, status: "ACTIVE" },
    select: { id: true, code: true },
  });
}

export function findGuestOptions(tx: Tx, organizationId: string) {
  return Promise.all([
    tx.vipLevel.findMany({
      where: { organizationId, status: "ACTIVE" },
      orderBy: [{ rank: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    tx.preferenceCode.findMany({
      where: { organizationId, status: "ACTIVE" },
      orderBy: [{ groupCode: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, groupCode: true },
    }),
  ]);
}

export function findPreferenceCodes(tx: Tx, organizationId: string, ids: string[]) {
  return tx.preferenceCode.findMany({
    where: { organizationId, status: "ACTIVE", id: { in: ids } },
    select: { id: true, code: true, groupCode: true },
  });
}

export function findPreferenceRows(tx: Tx, guestId: string) {
  return tx.guestPreference.findMany({
    where: { guestId },
    select: {
      id: true,
      propertyId: true,
      note: true,
      preferenceCode: { select: { id: true, code: true } },
    },
  });
}

/**
 * Replaces the preferences at the scopes the caller manages: global ones
 * (property null) and those of `propertyIds`. Preferences of other
 * properties are left untouched.
 */
export async function replacePreferences(
  tx: Tx,
  guestId: string,
  propertyIds: string[],
  rows: { preferenceCodeId: string; propertyId: string | null; note: string | null }[],
) {
  await tx.guestPreference.deleteMany({
    where: { guestId, OR: [{ propertyId: null }, { propertyId: { in: propertyIds } }] },
  });
  if (rows.length > 0) {
    await tx.guestPreference.createMany({ data: rows.map((r) => ({ ...r, guestId })) });
  }
}

export function insertNote(tx: Tx, data: Prisma.GuestNoteUncheckedCreateInput) {
  return tx.guestNote.create({ data, select: { id: true } });
}

export function findNote(tx: Tx, guestId: string, noteId: string) {
  return tx.guestNote.findFirst({
    where: { id: noteId, guestId, deletedAt: null },
    select: { id: true, visibility: true, propertyId: true, createdById: true, isAlert: true },
  });
}

export function softDeleteNote(tx: Tx, noteId: string) {
  return tx.guestNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
}

/** Counts and last stay over the given properties, from the reservation source rows. */
export async function guestStatistics(tx: Tx, guestId: string, propertyIds: string[]) {
  if (propertyIds.length === 0) {
    return { stays: 0, nights: 0, upcoming: 0, cancellations: 0, noShows: 0, lastStay: null };
  }
  const rows = await tx.$queryRaw<
    {
      stays: number;
      nights: number;
      upcoming: number;
      cancellations: number;
      no_shows: number;
      last_stay: string | null;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE rr."status" IN ('CHECKED_OUT', 'IN_HOUSE'))::int AS "stays",
      COALESCE(SUM(rr."departure_date" - rr."arrival_date")
        FILTER (WHERE rr."status" = 'CHECKED_OUT'), 0)::int AS "nights",
      COUNT(*) FILTER (WHERE rr."status" IN ('RESERVED', 'WAITLISTED'))::int AS "upcoming",
      COUNT(*) FILTER (WHERE rr."status" = 'CANCELLED')::int AS "cancellations",
      COUNT(*) FILTER (WHERE rr."status" = 'NO_SHOW')::int AS "no_shows",
      (MAX(rr."departure_date") FILTER (WHERE rr."status" = 'CHECKED_OUT'))::text AS "last_stay"
    FROM "reservation_rooms" rr
    WHERE rr."property_id" = ANY(${propertyIds}::uuid[])
      AND (rr."primary_guest_id" = ${guestId}::uuid OR EXISTS (
        SELECT 1 FROM "reservation_guests" rg
        WHERE rg."reservation_room_id" = rr."id" AND rg."guest_id" = ${guestId}::uuid))`;
  const r = rows[0]!;
  return {
    stays: r.stays,
    nights: r.nights,
    upcoming: r.upcoming,
    cancellations: r.cancellations,
    noShows: r.no_shows,
    lastStay: r.last_stay,
  };
}

export interface HistoryRow {
  id: string;
  reservation_id: string;
  property_id: string;
  property_code: string;
  property_name: string;
  confirmation_number: string;
  line_number: number;
  room_count: number;
  status: string;
  arrival: string;
  departure: string;
  room_type: string;
  room: string | null;
  rate_plan: string;
  company: string | null;
  group_name: string | null;
  is_primary: boolean;
  stay_id: string | null;
  stay_status: string | null;
  currency_code: string;
  room_total: string | null;
  balance: string | null;
}

/**
 * Reservation rooms of a guest (primary or sharing) across the given
 * properties, newest arrival first. One query: joins and per-row sums, no N+1.
 */
export function findGuestHistory(
  tx: Tx,
  guestId: string,
  propertyIds: string[],
  filters: { status?: string; from?: string; to?: string },
  after: { arrival: string; id: string } | null,
  limit: number,
) {
  const conditions = [
    Prisma.sql`rr."property_id" = ANY(${propertyIds}::uuid[])`,
    Prisma.sql`(rr."primary_guest_id" = ${guestId}::uuid OR EXISTS (
      SELECT 1 FROM "reservation_guests" rg
      WHERE rg."reservation_room_id" = rr."id" AND rg."guest_id" = ${guestId}::uuid))`,
  ];
  if (filters.status) conditions.push(Prisma.sql`rr."status"::text = ${filters.status}`);
  if (filters.from) conditions.push(Prisma.sql`rr."departure_date" > ${filters.from}::date`);
  if (filters.to) conditions.push(Prisma.sql`rr."arrival_date" <= ${filters.to}::date`);
  if (after) {
    conditions.push(
      Prisma.sql`(rr."arrival_date", rr."id") < (${after.arrival}::date, ${after.id}::uuid)`,
    );
  }
  return tx.$queryRaw<HistoryRow[]>`
    SELECT rr."id", rr."reservation_id", rr."property_id",
           p."code" AS "property_code", p."name" AS "property_name",
           r."confirmation_number", rr."line_number",
           (SELECT COUNT(*)::int FROM "reservation_rooms" x WHERE x."reservation_id" = rr."reservation_id") AS "room_count",
           rr."status"::text AS "status",
           rr."arrival_date"::text AS "arrival", rr."departure_date"::text AS "departure",
           rt."code" AS "room_type", rm."number" AS "room", rp."code" AS "rate_plan",
           ap."name" AS "company", g."name" AS "group_name",
           (rr."primary_guest_id" = ${guestId}::uuid) AS "is_primary",
           s."id" AS "stay_id", s."status"::text AS "stay_status",
           rr."currency_code",
           (SELECT SUM(n."rate_amount")::text FROM "reservation_room_nights" n
             WHERE n."reservation_room_id" = rr."id") AS "room_total",
           (SELECT SUM(f."balance")::text FROM "folios" f
             WHERE f."reservation_room_id" = rr."id") AS "balance"
    FROM "reservation_rooms" rr
    JOIN "reservations" r ON r."id" = rr."reservation_id"
    JOIN "properties" p ON p."id" = rr."property_id"
    JOIN "room_types" rt ON rt."id" = rr."room_type_id"
    JOIN "rate_plans" rp ON rp."id" = rr."rate_plan_id"
    LEFT JOIN "rooms" rm ON rm."id" = rr."room_id"
    LEFT JOIN "account_profiles" ap ON ap."id" = r."company_id"
    LEFT JOIN "groups" g ON g."id" = r."group_id"
    LEFT JOIN "stays" s ON s."reservation_room_id" = rr."id"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY rr."arrival_date" DESC, rr."id" DESC
    LIMIT ${limit}`;
}

export function findPropertiesByIds(tx: Tx, organizationId: string, ids: string[]) {
  return tx.property.findMany({
    where: { organizationId, id: { in: ids } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}

export async function findCurrencyDigits(tx: Tx, codes: string[]): Promise<Map<string, number>> {
  if (codes.length === 0) return new Map();
  const rows = await tx.currency.findMany({
    where: { code: { in: codes } },
    select: { code: true, minorUnits: true },
  });
  return new Map(rows.map((r) => [r.code, r.minorUnits]));
}
