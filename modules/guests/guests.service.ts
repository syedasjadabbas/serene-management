import "server-only";
import { randomInt } from "node:crypto";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type SessionContext } from "@/lib/http/context";
import { AppError, forbidden, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import {
  canAccessProperty,
  hasOrganizationPermission,
  hasPermission,
  hasPermissionAnywhere,
  propertiesWithPermission,
} from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { formatMoney, parseMoney } from "@/lib/utils/money";
import { recordAudit, resourceHistory } from "@/modules/audit/audit.service";
import { fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { displayConfirmation } from "@/modules/reservations/reservations.policy";
import {
  confirmationCandidates,
  parseConfirmationNumber,
} from "@/modules/properties/confirmation-number.policy";
import {
  dateOfBirthProblem,
  duplicateContactValue,
  duplicatePrimary,
  guestDisplayName,
  guestFullName,
  guestSearchName,
  normalizeName,
  noteVisible,
  phoneDigits,
} from "./guests.policy";
import {
  type GuestProfileRow,
  type GuestSummaryRow,
  findCurrencyDigits,
  findGuest,
  findGuestAnyStatus,
  findGuestHistory,
  findGuestIdsByConfirmation,
  findGuestOptions,
  findGuestProfile,
  findNote,
  findPossibleDuplicates,
  findPreferenceCodes,
  findPreferenceRows,
  findPropertiesByIds,
  findUserNames,
  findVipLevel,
  guestStatistics,
  insertGuest,
  insertNote,
  lockGuest,
  profileNumberExists,
  bumpGuestVersion,
  replaceAddresses,
  replaceContacts,
  replacePreferences,
  searchGuests as searchGuestRows,
  softDeleteNote,
  updateGuestVersioned,
} from "./guests.repository";
import type {
  CreateGuestInput,
  CreateGuestNoteInput,
  GuestHistoryQuery,
  GuestPreferencesInput,
  GuestSearchQuery,
  UpdateGuestInput,
} from "./guests.schema";
import type {
  GuestHistoryPage,
  GuestListPage,
  GuestOptions,
  GuestProfileView,
  GuestSummaryView,
  LoyaltyMembershipView,
} from "./guests.types";

/**
 * Guest profiles are organization data (docs/DOMAIN_MODEL.md §2, RBAC §5):
 * a user holding a guests:* permission at any property of the organization
 * may use it on profiles. Property facts (history, balances, property notes
 * and preferences) are limited to the properties where the user holds the
 * relevant permission; profiles of other organizations are never found.
 */

const can = (ctx: SessionContext, permission: Permission) =>
  hasPermissionAnywhere(ctx.access, permission);

function requirePermission(ctx: SessionContext, permission: Permission) {
  if (!can(ctx, permission)) throw forbidden(permission);
}

function invalid(field: string, message: string) {
  return new AppError("VALIDATION_FAILED", message, { fields: { [field]: [message] } });
}

// --- Search ----------------------------------------------------------------------------

export async function searchGuests(
  ctx: SessionContext,
  query: GuestSearchQuery,
): Promise<GuestListPage> {
  requirePermission(ctx, "guests:read");
  let after: { lastName: string; firstName: string; id: string } | null = null;
  if (query.cursor) {
    const c = decodeCursor(query.cursor, ["l", "f", "i"] as const);
    if (!c) throw invalid("cursor", "Invalid cursor");
    after = { lastName: c.l, firstName: c.f, id: c.i };
  }
  let terms = null;
  if (query.q) {
    const raw = query.q.trim();
    // A confirmation number finds its guests, but only in properties whose
    // reservations the caller may read.
    // "SMR-100045", "SMR-100045-2", legacy "100029" and bare digits of a
    // prefixed number are all understood (D36).
    const confirmation = parseConfirmationNumber(raw);
    const confirmationGuestIds = confirmation
      ? await findGuestIdsByConfirmation(
          prisma,
          propertiesWithPermission(ctx.access, "reservations:read"),
          confirmationCandidates(confirmation),
        )
      : [];
    terms = {
      nameTokens: normalizeName(raw).split(" ").filter(Boolean).slice(0, 5),
      raw,
      digits: raw.replace(/\D/g, ""),
      confirmationGuestIds,
    };
  }
  const rows = await searchGuestRows(
    prisma,
    ctx.organizationId,
    query.status,
    terms,
    after,
    query.limit + 1,
  );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toGuestSummary),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ l: last.lastName, f: last.firstName, i: last.id })
        : null,
  };
}

/** Loads an active guest of the caller's organization inside a transaction (for reservations). */
export async function requireGuest(
  tx: Tx,
  organizationId: string,
  guestId: string,
): Promise<GuestSummaryView> {
  const row = await findGuest(tx, organizationId, guestId);
  if (!row) throw notFound("Guest");
  return toGuestSummary(row);
}

// --- Create ----------------------------------------------------------------------------

export async function createGuest(
  ctx: SessionContext,
  input: CreateGuestInput,
): Promise<GuestSummaryView> {
  requirePermission(ctx, "guests:create");
  return runInTransaction(async (tx) => {
    const digits = phoneDigits(input.phone);
    if (!input.allowDuplicate) {
      const matches = await findPossibleDuplicates(
        tx,
        ctx.organizationId,
        input.email ?? null,
        digits,
      );
      if (matches.length > 0) {
        throw new AppError("CONFLICT", "A guest profile with this e-mail or phone already exists", {
          reason: "POSSIBLE_DUPLICATE",
          matches: matches.map((m) => ({
            id: m.id,
            profileNumber: m.profileNumber,
            fullName: guestFullName(m),
            email: m.primaryEmail,
            phone: m.primaryPhone,
          })),
        });
      }
    }
    const profileNumber = await newProfileNumber(tx, ctx.organizationId);
    const row = await insertGuest(tx, {
      organizationId: ctx.organizationId,
      profileNumber,
      title: input.title ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      preferredName: input.preferredName ?? null,
      searchName: guestSearchName(input.firstName, input.lastName),
      primaryEmail: input.email ?? null,
      primaryPhone: input.phone ?? null,
      phoneDigits: digits,
      nationalityCode: input.nationalityCode ?? null,
      languageCode: input.languageCode ?? null,
    });
    const view = toGuestSummary(row);
    await recordAudit(tx, auditActor(ctx), {
      action: "guest.create",
      resourceType: "Guest",
      resourceId: row.id,
      after: {
        profileNumber,
        name: view.fullName,
        email: view.email,
        phone: view.phone,
        duplicateAcknowledged: input.allowDuplicate || undefined,
      },
      permission: "guests:create",
    });
    return view;
  });
}

/** "G" + 7 characters from an unambiguous alphabet; retried on the (unlikely) collision. */
const PROFILE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

async function newProfileNumber(tx: Tx, organizationId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const body = Array.from(
      { length: 7 },
      () => PROFILE_ALPHABET[randomInt(PROFILE_ALPHABET.length)],
    ).join("");
    const candidate = `G${body}`;
    if ((await profileNumberExists(tx, organizationId, candidate)) === 0) return candidate;
  }
  throw new Error("Could not allocate a unique guest profile number");
}

// --- Profile -------------------------------------------------------------------------------

export async function getGuest(ctx: SessionContext, guestId: string): Promise<GuestProfileView> {
  requirePermission(ctx, "guests:read");
  const row = await findGuestProfile(prisma, ctx.organizationId, guestId);
  if (!row) throw notFound("Guest");
  const statistics = await guestStatistics(
    prisma,
    guestId,
    propertiesWithPermission(ctx.access, "reservations:read"),
  );
  const userIds = [
    ...row.notes.map((n) => n.createdById),
    ...row.loyaltyMemberships.flatMap((m) => m.changes.map((c) => c.createdById)),
  ];
  const names = new Map(
    (await findUserNames(prisma, ctx.organizationId, userIds)).map((u) => [u.id, u.displayName]),
  );
  const history = can(ctx, "audit:read")
    ? await resourceHistory(prisma, ctx, [guestId, ...row.loyaltyMemberships.map((m) => m.id)])
    : null;
  return { ...toProfile(ctx, row, statistics, names), history };
}

export async function guestOptions(ctx: SessionContext): Promise<GuestOptions> {
  requirePermission(ctx, "guests:read");
  const [vipLevels, preferenceCodes] = await findGuestOptions(prisma, ctx.organizationId);
  const properties = await findPropertiesByIds(
    prisma,
    ctx.organizationId,
    propertiesWithPermission(ctx.access, "guests:read"),
  );
  return { vipLevels, preferenceCodes, properties };
}

const SENSITIVE_FIELDS = ["dateOfBirth"] as const;

export async function updateGuest(
  ctx: SessionContext,
  guestId: string,
  input: UpdateGuestInput,
): Promise<GuestProfileView> {
  requirePermission(ctx, "guests:update");
  const readSensitive = can(ctx, "guests:read_sensitive");
  if (input.dateOfBirth !== undefined && !readSensitive) throw forbidden("guests:read_sensitive");
  const restrictionChange = input.isRestricted !== undefined;
  const statusChange = input.status !== undefined;
  if ((restrictionChange || statusChange) && !input.reason) {
    throw invalid("reason", "A reason is required to change the restriction or status");
  }
  if (input.isRestricted && !input.restrictionReason) {
    throw invalid("restrictionReason", "Describe why the profile is restricted");
  }
  if (input.dateOfBirth) {
    const problem = dateOfBirthProblem(input.dateOfBirth, toDateOnly(new Date()));
    if (problem) throw invalid("dateOfBirth", problem);
  }
  if (input.contacts) {
    const type = duplicatePrimary(input.contacts);
    if (type) throw invalid("contacts", `Only one primary ${type.toLowerCase()} is allowed`);
    const value = duplicateContactValue(input.contacts);
    if (value) throw invalid("contacts", `${value} is listed twice`);
  }
  if (input.addresses && input.addresses.filter((a) => a.isPrimary).length > 1) {
    throw invalid("addresses", "Only one primary address is allowed");
  }

  await runInTransaction(async (tx) => {
    const locked = await lockGuest(tx, ctx.organizationId, guestId);
    if (!locked) throw notFound("Guest");
    if (locked.version !== input.version) throw staleVersion("Guest profile");
    const before = await findGuestProfile(tx, ctx.organizationId, guestId);
    if (!before) throw notFound("Guest");
    if (input.vipLevelId && !(await findVipLevel(tx, ctx.organizationId, input.vipLevelId))) {
      throw notFound("VIP level");
    }

    const firstName = input.firstName ?? before.firstName;
    const lastName = input.lastName ?? before.lastName;
    const data = {
      title: input.title,
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      preferredName: input.preferredName,
      gender: input.gender,
      dateOfBirth:
        input.dateOfBirth === undefined
          ? undefined
          : input.dateOfBirth === null
            ? null
            : fromDateOnly(input.dateOfBirth),
      primaryEmail: input.email,
      primaryPhone: input.phone,
      phoneDigits: input.phone === undefined ? undefined : phoneDigits(input.phone),
      preferredContact: input.preferredContact,
      nationalityCode: input.nationalityCode,
      languageCode: input.languageCode,
      vipLevelId: input.vipLevelId,
      marketingOptIn: input.marketingOptIn,
      status: input.status,
      isRestricted: input.isRestricted,
      restrictionReason:
        input.isRestricted === false ? null : (input.restrictionReason ?? undefined),
      searchName: guestSearchName(firstName, lastName),
    };
    const { count } = await updateGuestVersioned(tx, guestId, input.version, data);
    if (count !== 1) throw staleVersion("Guest profile");
    if (input.contacts) await replaceContacts(tx, guestId, input.contacts);
    if (input.addresses) {
      await replaceAddresses(
        tx,
        guestId,
        input.addresses.map((a) => ({
          type: a.type,
          line1: a.line1,
          line2: a.line2 ?? null,
          city: a.city ?? null,
          region: a.region ?? null,
          postalCode: a.postalCode ?? null,
          countryCode: a.countryCode ?? null,
          isPrimary: a.isPrimary,
        })),
      );
    }

    // Audit the changed fields only; sensitive values are recorded as changed, never stored.
    const compare: Record<string, [unknown, unknown]> = {
      title: [before.title, input.title],
      firstName: [before.firstName, input.firstName],
      middleName: [before.middleName, input.middleName],
      lastName: [before.lastName, input.lastName],
      preferredName: [before.preferredName, input.preferredName],
      gender: [before.gender, input.gender],
      dateOfBirth: [before.dateOfBirth ? toDateOnly(before.dateOfBirth) : null, input.dateOfBirth],
      email: [before.primaryEmail, input.email],
      phone: [before.primaryPhone, input.phone],
      preferredContact: [before.preferredContact, input.preferredContact],
      nationalityCode: [before.nationalityCode, input.nationalityCode],
      languageCode: [before.languageCode, input.languageCode],
      vipLevelId: [before.vipLevelId, input.vipLevelId],
      marketingOptIn: [before.marketingOptIn, input.marketingOptIn],
      status: [before.status, input.status],
      isRestricted: [before.isRestricted, input.isRestricted],
      restrictionReason: [before.restrictionReason, input.restrictionReason],
    };
    const beforeAudit: Record<string, unknown> = {};
    const afterAudit: Record<string, unknown> = {};
    for (const [field, [was, now]] of Object.entries(compare)) {
      if (now === undefined || (was ?? null) === (now ?? null)) continue;
      const sensitive = (SENSITIVE_FIELDS as readonly string[]).includes(field);
      beforeAudit[field] = sensitive ? "(sensitive)" : (was ?? null);
      afterAudit[field] = sensitive ? "(changed)" : (now ?? null);
    }
    if (input.contacts) afterAudit.contacts = input.contacts.length;
    if (input.addresses) afterAudit.addresses = input.addresses.length;
    const highRisk =
      "isRestricted" in afterAudit || "status" in afterAudit || "dateOfBirth" in afterAudit;
    await recordAudit(tx, auditActor(ctx), {
      action: "guest.update",
      resourceType: "Guest",
      resourceId: guestId,
      risk: highRisk ? "HIGH" : "STANDARD",
      before: beforeAudit,
      after: afterAudit,
      reason: input.reason ?? null,
      permission: "guests:update",
    });
  });
  return getGuest(ctx, guestId);
}

// --- Preferences ---------------------------------------------------------------------------

export async function setGuestPreferences(
  ctx: SessionContext,
  guestId: string,
  input: GuestPreferencesInput,
): Promise<GuestProfileView> {
  requirePermission(ctx, "guests:update");
  const managed = propertiesWithPermission(ctx.access, "guests:update");
  // Preferences for every property are organization data (D3): only an
  // organization-scope grant may change them. Property staff resend them
  // unchanged and manage their own property's preferences.
  const manageGlobal = hasOrganizationPermission(ctx.access, "guests:update");
  for (const p of input.preferences) {
    if (p.propertyId && !managed.includes(p.propertyId)) throw forbidden("guests:update");
  }
  const keys = input.preferences.map((p) => `${p.preferenceCodeId}:${p.propertyId ?? "*"}`);
  if (new Set(keys).size !== keys.length) {
    throw invalid("preferences", "Each preference can be set once per scope");
  }
  await runInTransaction(async (tx) => {
    const locked = await lockGuest(tx, ctx.organizationId, guestId);
    if (!locked) throw notFound("Guest");
    if (locked.version !== input.version) throw staleVersion("Guest profile");
    const codes = await findPreferenceCodes(tx, ctx.organizationId, [
      ...new Set(input.preferences.map((p) => p.preferenceCodeId)),
    ]);
    const byId = new Map(codes.map((c) => [c.id, c]));
    if (input.preferences.some((p) => !byId.has(p.preferenceCodeId))) {
      throw notFound("Preference");
    }
    const before = (await findPreferenceRows(tx, guestId)).filter(
      (p) => p.propertyId === null || managed.includes(p.propertyId),
    );
    if (!manageGlobal) {
      const globalKey = (id: string, note: string | null) => `${id}:${note ?? ""}`;
      const existing = before
        .filter((p) => p.propertyId === null)
        .map((p) => globalKey(p.preferenceCode.id, p.note))
        .sort();
      const requested = input.preferences
        .filter((p) => p.propertyId === null)
        .map((p) => globalKey(p.preferenceCodeId, p.note ?? null))
        .sort();
      if (existing.join("|") !== requested.join("|")) {
        throw new AppError(
          "FORBIDDEN",
          "Preferences for every property need an organization-level grant",
          { permission: "guests:update", reason: "ORGANIZATION_SCOPE_REQUIRED" },
        );
      }
    }
    await replacePreferences(
      tx,
      guestId,
      managed,
      manageGlobal,
      input.preferences
        .filter((p) => manageGlobal || p.propertyId !== null)
        .map((p) => ({
          preferenceCodeId: p.preferenceCodeId,
          propertyId: p.propertyId,
          note: p.note ?? null,
        })),
    );
    const describe = (code: string, propertyId: string | null, note: string | null) =>
      `${code}${propertyId ? `@${propertyId}` : ""}${note ? ` (${note})` : ""}`;
    const beforeList = before.map((p) => describe(p.preferenceCode.code, p.propertyId, p.note));
    const afterList = input.preferences.map((p) =>
      describe(byId.get(p.preferenceCodeId)!.code, p.propertyId, p.note ?? null),
    );
    await bumpGuestVersion(tx, guestId, input.version);
    await recordAudit(tx, auditActor(ctx), {
      action: "guest.preferences",
      resourceType: "Guest",
      resourceId: guestId,
      before: { preferences: beforeList.sort() },
      after: { preferences: afterList.sort() },
      permission: "guests:update",
    });
  });
  return getGuest(ctx, guestId);
}

// --- Notes ---------------------------------------------------------------------------------

export async function addGuestNote(
  ctx: SessionContext,
  guestId: string,
  input: CreateGuestNoteInput,
): Promise<GuestProfileView> {
  requirePermission(ctx, "guests:update");
  if (input.visibility !== "ALL_STAFF" && !can(ctx, "guests:read_sensitive")) {
    throw forbidden("guests:read_sensitive");
  }
  if (input.propertyId && !hasPermission(ctx.access, input.propertyId, "guests:update")) {
    throw forbidden("guests:update");
  }
  await runInTransaction(async (tx) => {
    const locked = await lockGuest(tx, ctx.organizationId, guestId);
    if (!locked) throw notFound("Guest");
    const note = await insertNote(tx, {
      guestId,
      propertyId: input.propertyId,
      body: input.body,
      visibility: input.visibility,
      isAlert: input.isAlert,
      createdById: ctx.userId,
    });
    await recordAudit(tx, auditActor(ctx), {
      action: "guest.note_add",
      resourceType: "Guest",
      resourceId: guestId,
      after: {
        noteId: note.id,
        visibility: input.visibility,
        isAlert: input.isAlert,
        propertyId: input.propertyId,
        // Restricted notes are not copied into the audit trail.
        body: input.visibility === "ALL_STAFF" ? input.body : "(restricted)",
      },
      permission: "guests:update",
    });
  });
  return getGuest(ctx, guestId);
}

export async function deleteGuestNote(
  ctx: SessionContext,
  guestId: string,
  noteId: string,
): Promise<GuestProfileView> {
  requirePermission(ctx, "guests:update");
  await runInTransaction(async (tx) => {
    const locked = await lockGuest(tx, ctx.organizationId, guestId);
    if (!locked) throw notFound("Guest");
    const note = await findNote(tx, guestId, noteId);
    if (!note || !noteReadable(ctx, note)) throw notFound("Note");
    if (note.propertyId && !hasPermission(ctx.access, note.propertyId, "guests:update")) {
      throw forbidden("guests:update");
    }
    await softDeleteNote(tx, noteId);
    await recordAudit(tx, auditActor(ctx), {
      action: "guest.note_delete",
      resourceType: "Guest",
      resourceId: guestId,
      before: { noteId, visibility: note.visibility, isAlert: note.isAlert },
      permission: "guests:update",
    });
  });
  return getGuest(ctx, guestId);
}

function noteReadable(
  ctx: SessionContext,
  note: { visibility: "ALL_STAFF" | "MANAGEMENT" | "INTERNAL"; propertyId: string | null },
): boolean {
  if (!noteVisible(note.visibility, can(ctx, "guests:read_sensitive"))) return false;
  return note.propertyId === null || canAccessProperty(ctx.access, note.propertyId);
}

// --- History -------------------------------------------------------------------------------

export async function guestHistory(
  ctx: SessionContext,
  guestId: string,
  query: GuestHistoryQuery,
): Promise<GuestHistoryPage> {
  requirePermission(ctx, "guests:read");
  if (!(await findGuestAnyStatus(prisma, ctx.organizationId, guestId))) throw notFound("Guest");
  const readable = propertiesWithPermission(ctx.access, "reservations:read");
  if (query.propertyId && !readable.includes(query.propertyId)) {
    throw forbidden("reservations:read");
  }
  const propertyIds = query.propertyId ? [query.propertyId] : readable;
  let after: { arrival: string; id: string } | null = null;
  if (query.cursor) {
    const c = decodeCursor(query.cursor, ["a", "i"] as const);
    if (!c) throw invalid("cursor", "Invalid cursor");
    after = { arrival: c.a, id: c.i };
  }
  const rows =
    propertyIds.length === 0
      ? []
      : await findGuestHistory(
          prisma,
          guestId,
          propertyIds,
          { status: query.status, from: query.from, to: query.to },
          after,
          query.limit + 1,
        );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const financial = new Set(propertiesWithPermission(ctx.access, "billing:read"));
  const digits = await findCurrencyDigits(prisma, [...new Set(page.map((r) => r.currency_code))]);
  const money = (value: string | null, propertyId: string, currency: string) =>
    value === null || !financial.has(propertyId)
      ? null
      : formatMoney(parseMoney(value), digits.get(currency) ?? 2);
  return {
    items: page.map((r) => ({
      reservationRoomId: r.id,
      reservationId: r.reservation_id,
      property: { id: r.property_id, code: r.property_code, name: r.property_name },
      confirmation: displayConfirmation(r.confirmation_number, r.line_number, r.room_count),
      status: r.status,
      arrival: r.arrival,
      departure: r.departure,
      nights: Math.round(
        (Date.parse(`${r.departure}T00:00:00Z`) - Date.parse(`${r.arrival}T00:00:00Z`)) /
          86_400_000,
      ),
      roomType: r.room_type,
      room: r.room,
      ratePlan: r.rate_plan,
      company: can(ctx, "accounts:read") ? r.company : null,
      group: r.group_name,
      isPrimaryGuest: r.is_primary,
      stay: r.stay_id ? { id: r.stay_id, status: r.stay_status! } : null,
      roomTotal: money(r.room_total, r.property_id, r.currency_code),
      balance:
        r.stay_id || r.balance ? money(r.balance ?? "0", r.property_id, r.currency_code) : null,
      currencyCode: r.currency_code,
    })),
    nextCursor:
      rows.length > query.limit && last ? encodeCursor({ a: last.arrival, i: last.id }) : null,
    properties: await findPropertiesByIds(prisma, ctx.organizationId, readable),
  };
}

// --- Views ---------------------------------------------------------------------------------

export function toGuestSummary(row: GuestSummaryRow): GuestSummaryView {
  return {
    id: row.id,
    profileNumber: row.profileNumber,
    title: row.title,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: guestFullName(row),
    email: row.primaryEmail,
    phone: row.primaryPhone,
    nationalityCode: row.nationalityCode,
    vip: row.vipLevel,
    isRestricted: row.isRestricted,
  };
}

export function toLoyaltyView(
  m: GuestProfileRow["loyaltyMemberships"][number],
  names: Map<string, string>,
): LoyaltyMembershipView {
  return {
    id: m.id,
    version: m.version,
    program: m.program,
    membershipNumber: m.membershipNumber,
    tier: m.tier,
    status: m.status,
    pointsBalance: m.pointsBalance.toFixed(0),
    enrolledAt: m.enrolledAt.toISOString(),
    changes: m.changes.map((c) => ({
      id: c.id,
      type: c.type,
      fromTier: c.fromTier?.name ?? null,
      toTier: c.toTier?.name ?? null,
      fromStatus: c.fromStatus,
      toStatus: c.toStatus,
      reason: c.reason,
      by: names.get(c.createdById) ?? null,
      at: c.createdAt.toISOString(),
    })),
    transactions: m.transactions.map((t) => ({
      id: t.id,
      type: t.type,
      points: t.points.toFixed(0),
      description: t.description,
      at: t.createdAt.toISOString(),
    })),
  };
}

function toProfile(
  ctx: SessionContext,
  row: GuestProfileRow,
  statistics: GuestProfileView["statistics"],
  names: Map<string, string>,
): Omit<GuestProfileView, "history"> {
  const readSensitive = can(ctx, "guests:read_sensitive");
  const visibleProperty = (propertyId: string | null) =>
    propertyId === null || canAccessProperty(ctx.access, propertyId);
  const notes = row.notes.filter((n) => noteReadable(ctx, n));
  const update = can(ctx, "guests:update");
  return {
    ...toGuestSummary(row),
    version: row.version,
    status: row.status,
    middleName: row.middleName,
    preferredName: row.preferredName,
    displayName: guestDisplayName(row),
    gender: row.gender,
    dateOfBirth: readSensitive && row.dateOfBirth ? toDateOnly(row.dateOfBirth) : null,
    languageCode: row.languageCode,
    preferredContact: row.preferredContact,
    marketingOptIn: row.marketingOptIn,
    restrictionReason: row.restrictionReason,
    vipLevelId: row.vipLevelId,
    contacts: row.contacts,
    addresses: row.addresses,
    preferences: row.preferences
      .filter((p) => visibleProperty(p.propertyId))
      .map((p) => ({
        id: p.id,
        preferenceCode: p.preferenceCode,
        property: p.property,
        note: p.note,
      })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      visibility: n.visibility,
      isAlert: n.isAlert,
      property: n.property,
      createdBy: names.get(n.createdById) ?? null,
      createdAt: n.createdAt.toISOString(),
      canDelete:
        update &&
        (n.propertyId === null || hasPermission(ctx.access, n.propertyId, "guests:update")),
    })),
    alerts: notes.filter((n) => n.isAlert).map((n) => n.body),
    companies: can(ctx, "accounts:read")
      ? row.accountContacts.map((c) => ({
          account: c.account,
          kind: c.kind,
          role: c.role,
          isPrimary: c.isPrimary,
        }))
      : null,
    loyalty: can(ctx, "loyalty:read")
      ? row.loyaltyMemberships.map((m) => toLoyaltyView(m, names))
      : null,
    statistics,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    access: {
      update,
      readSensitive,
      addNote: update,
      manageCompanies: can(ctx, "accounts:manage"),
      manageGlobalPreferences: hasOrganizationPermission(ctx.access, "guests:update"),
      enrollLoyalty: can(ctx, "loyalty:manage"),
      manageLoyalty: hasOrganizationPermission(ctx.access, "loyalty:manage"),
      readHistory: propertiesWithPermission(ctx.access, "reservations:read").length > 0,
    },
  };
}
