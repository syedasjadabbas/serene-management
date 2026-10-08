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
 * The LIKE pattern body for a query that looks like part of an e-mail
 * address (one word with "@" or ".", 3+ characters), lower-cased with LIKE
 * wildcards escaped ("_" is common in addresses); null otherwise.
 */
export function emailFragment(raw: string): string | null {
  const q = raw.trim().toLowerCase();
  if (q.length < 3 || /\s/.test(q) || !/[@.]/.test(q)) return null;
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Organization-scoped guest search / list, keyset-paginated on
 * (last name, first name, id). Name words use the trigram index on
 * search_name (every word must appear, any order); e-mail is exact (primary
 * or any listed e-mail) or, for part of an address, a contains match on the
 * primary e-mail (trigram index); phone digits use the trigram index on
 * phone_digits.
 *
 * With search terms the page comes from one statement that picks the
 * cheapest of three exact ways (scalability phase 8, docs/SCALABILITY.md §36):
 *
 * 1. Few matches: at most SEARCH_CANDIDATE_CAP matching guests, found one
 *    branch of the OR at a time on its own index. If that is all of them,
 *    the page is sorted from them (rare names, e-mail, profile, phone).
 * 2. Many matches early in name order: the first SEARCH_WINDOW guests of the
 *    organization after the cursor, filtered by status and terms. If at
 *    least `limit` match, they are the page: every guest beyond the window
 *    sorts after all of them.
 * 3. Otherwise: every match by branch, deduplicated, sorted.
 *
 * Each step runs only when the previous one could not answer (one-time
 * filters). The former single statement with the OR made PostgreSQL walk the
 * name index from the start and test each guest. Names cluster by last name
 * (search_name starts with it), so a common surname late in the alphabet,
 * a full name or an e-mail read up to the whole table: 135,000–300,000
 * buffers and 0.1–2.6 s per page on 300,000 guests.
 */
export async function searchGuests(
  tx: Tx,
  organizationId: string,
  status: "ACTIVE" | "INACTIVE",
  terms: GuestSearchTerms | null,
  after: { lastName: string; firstName: string; id: string } | null,
  limit: number,
  /** Tests lower these to exercise every step on small data. */
  sizes: { window?: number; cap?: number } = {},
): Promise<GuestSummaryRow[]> {
  if (!terms) return listGuests(tx, organizationId, status, after, limit);
  const window = sizes.window ?? SEARCH_WINDOW;
  const cap = sizes.cap ?? SEARCH_CANDIDATE_CAP;
  const eligible = Prisma.sql`g."organization_id" = ${organizationId}::uuid
    AND g."status" = ${status}::"profile_status" AND g."deleted_at" IS NULL`;
  const afterCursor = after
    ? Prisma.sql`AND (g."last_name" > ${after.lastName}
        OR (g."last_name" = ${after.lastName} AND g."first_name" > ${after.firstName})
        OR (g."last_name" = ${after.lastName} AND g."first_name" = ${after.firstName}
            AND g."id" > ${after.id}::uuid))`
    : Prisma.empty;
  // The same condition as a row comparison (the columns are NOT NULL), which
  // lets the window start at the cursor in the name index instead of walking
  // to it from the beginning.
  const windowCursor = after
    ? Prisma.sql`AND (g."last_name", g."first_name", g."id")
        > (${after.lastName}::varchar, ${after.firstName}::varchar, ${after.id}::uuid)`
    : Prisma.empty;
  // The OR of the terms (as before): name words, e-mail, phone digits,
  // profile number, guests of a matching confirmation number.
  const or: Prisma.Sql[] = [];
  const branches: Prisma.Sql[] = [];
  const cols = Prisma.sql`g."id", g."profile_number", g."title", g."first_name", g."last_name",
    g."primary_email", g."primary_phone", g."nationality_code", g."is_restricted", g."vip_level_id"`;
  const branch = (from: Prisma.Sql, condition: Prisma.Sql) =>
    Prisma.sql`SELECT ${cols} FROM ${from} WHERE ${eligible} ${afterCursor} AND ${condition}`;
  const guests = Prisma.sql`"guests" g`;
  if (terms.nameTokens.length > 0) {
    const words = Prisma.join(
      terms.nameTokens.map((token) => Prisma.sql`g."search_name" LIKE ${`%${token}%`}`),
      " AND ",
    );
    or.push(Prisma.sql`(${words})`);
    branches.push(branch(guests, words));
  }
  if (terms.raw.includes("@")) {
    const email = terms.raw.toLowerCase();
    or.push(Prisma.sql`g."primary_email" = ${email}`);
    branches.push(branch(guests, Prisma.sql`g."primary_email" = ${email}`));
    const listed = Prisma.sql`EXISTS (SELECT 1 FROM "guest_contacts" c
      WHERE c."guest_id" = g."id" AND c."type" = 'EMAIL' AND c."value" = ${email})`;
    or.push(listed);
    branches.push(
      branch(
        Prisma.sql`"guest_contacts" c JOIN "guests" g ON g."id" = c."guest_id"`,
        Prisma.sql`c."type" = 'EMAIL' AND c."value" = ${email}`,
      ),
    );
  }
  const fragment = emailFragment(terms.raw);
  if (fragment) {
    // Part of an e-mail address ("ahmed.almansoori", "@example.com"): the
    // trigram index on primary_email serves the contains match.
    const partial = Prisma.sql`g."primary_email" LIKE ${`%${fragment}%`}`;
    or.push(partial);
    branches.push(branch(guests, partial));
  }
  if (terms.digits.length >= 4) {
    const phone = Prisma.sql`g."phone_digits" LIKE ${`%${terms.digits}%`}`;
    or.push(phone);
    branches.push(branch(guests, phone));
  }
  const profile = Prisma.sql`g."profile_number" = ${terms.raw.toUpperCase()}`;
  or.push(profile);
  branches.push(branch(guests, profile));
  if (terms.confirmationGuestIds.length > 0) {
    const ids = Prisma.sql`g."id" = ANY(${terms.confirmationGuestIds}::uuid[])`;
    or.push(ids);
    branches.push(branch(guests, ids));
  }
  const order = Prisma.sql`"last_name", "first_name", "id"`;
  const rows = await tx.$queryRaw<SearchRow[]>`
    WITH "capped" AS MATERIALIZED (
      SELECT * FROM (${Prisma.join(branches, " UNION ALL ")}) m LIMIT ${cap + 1}
    ), "few" AS MATERIALIZED (
      SELECT count(*) <= ${cap} AS "yes" FROM "capped"
    ), "windowed" AS MATERIALIZED (
      SELECT g."id", g."profile_number", g."title", g."first_name", g."last_name",
             g."primary_email", g."primary_phone", g."nationality_code", g."is_restricted",
             g."vip_level_id"
      FROM (
        SELECT g.* FROM "guests" g
        WHERE g."organization_id" = ${organizationId}::uuid ${windowCursor}
        ORDER BY g."last_name", g."first_name", g."id"
        LIMIT ${window}
      ) g
      WHERE NOT (SELECT "yes" FROM "few")
        AND g."status" = ${status}::"profile_status" AND g."deleted_at" IS NULL
        AND (${Prisma.join(or, " OR ")})
      ORDER BY ${order}
      LIMIT ${limit}
    ), "page" AS (
      SELECT * FROM (SELECT DISTINCT * FROM "capped" ORDER BY ${order} LIMIT ${limit}) m
      WHERE (SELECT "yes" FROM "few")
      UNION ALL
      SELECT * FROM "windowed"
      WHERE NOT (SELECT "yes" FROM "few") AND (SELECT count(*) FROM "windowed") >= ${limit}
      UNION ALL
      SELECT * FROM (
        SELECT * FROM (${Prisma.join(branches, " UNION ")}) m
        ORDER BY ${order}
        LIMIT ${limit}
      ) m
      WHERE NOT (SELECT "yes" FROM "few") AND (SELECT count(*) FROM "windowed") < ${limit}
    )
    SELECT p."id", p."profile_number", p."title", p."first_name", p."last_name",
           p."primary_email", p."primary_phone", p."nationality_code", p."is_restricted",
           v."code" AS "vip_code", v."name" AS "vip_name"
    FROM "page" p
    LEFT JOIN "vip_levels" v ON v."id" = p."vip_level_id"
    ORDER BY p."last_name", p."first_name", p."id"`;
  return rows.map((row) => ({
    id: row.id,
    profileNumber: row.profile_number,
    title: row.title,
    firstName: row.first_name,
    lastName: row.last_name,
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    nationalityCode: row.nationality_code,
    isRestricted: row.is_restricted,
    vipLevel: row.vip_code === null ? null : { code: row.vip_code, name: row.vip_name! },
  }));
}

/**
 * Step 1 (few matches): up to this many candidates are collected; more means
 * "many matches". Step 2 (early in name order): this many guests are looked
 * at in page order. Measured on 300,000 guests (docs/SCALABILITY.md §36).
 */
export const SEARCH_CANDIDATE_CAP = 1_000;
export const SEARCH_WINDOW = 3_000;

interface SearchRow {
  id: string;
  profile_number: string;
  title: string | null;
  first_name: string;
  last_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  nationality_code: string | null;
  is_restricted: boolean;
  vip_code: string | null;
  vip_name: string | null;
}

/** The guest list without search terms (name order from the index). */
function listGuests(
  tx: Tx,
  organizationId: string,
  status: "ACTIVE" | "INACTIVE",
  after: { lastName: string; firstName: string; id: string } | null,
  limit: number,
) {
  const and: Prisma.GuestWhereInput[] = [{ organizationId, status, deletedAt: null }];
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
  candidates: { equals: string[]; endsWith: string | null },
): Promise<string[]> {
  if (propertyIds.length === 0) return [];
  const rows = await tx.reservationRoom.findMany({
    where: {
      propertyId: { in: propertyIds },
      reservation: {
        OR: [
          { confirmationNumber: { in: candidates.equals } },
          ...(candidates.endsWith
            ? [{ confirmationNumber: { endsWith: candidates.endsWith } }]
            : []),
        ],
      },
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
 * (property null, only with `includeGlobal`) and those of `propertyIds`.
 * Preferences of other scopes are left untouched.
 */
export async function replacePreferences(
  tx: Tx,
  guestId: string,
  propertyIds: string[],
  includeGlobal: boolean,
  rows: { preferenceCodeId: string; propertyId: string | null; note: string | null }[],
) {
  await tx.guestPreference.deleteMany({
    where: {
      guestId,
      OR: [...(includeGlobal ? [{ propertyId: null }] : []), { propertyId: { in: propertyIds } }],
    },
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

/**
 * Reservation rooms (alias `rr`) the guest is on, as primary guest or sharer.
 * Written as an IN over two index lookups, not `primary_guest_id = g OR EXISTS
 * (sharer)`: that OR cannot use either index, so PostgreSQL scanned every
 * reservation room of the properties per profile view (docs/SCALABILITY.md).
 */
function onGuestReservationRooms(guestId: string) {
  return Prisma.sql`rr."id" IN (
    SELECT x."id" FROM "reservation_rooms" x WHERE x."primary_guest_id" = ${guestId}::uuid
    UNION
    SELECT rg."reservation_room_id" FROM "reservation_guests" rg WHERE rg."guest_id" = ${guestId}::uuid)`;
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
      AND ${onGuestReservationRooms(guestId)}`;
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
    onGuestReservationRooms(guestId),
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
