import "server-only";
import { randomInt } from "node:crypto";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type SessionContext } from "@/lib/http/context";
import { forbidden, notFound } from "@/lib/http/errors";
import { hasPermissionAnywhere } from "@/lib/permissions/evaluate";
import { recordAudit } from "@/modules/audit/audit.service";
import { guestFullName, guestSearchName, normalizeName } from "./guests.policy";
import {
  type GuestSummaryRow,
  findGuest,
  insertGuest,
  profileNumberExists,
  searchGuests as searchGuestRows,
} from "./guests.repository";
import type { CreateGuestInput, GuestSearchQuery } from "./guests.schema";
import type { GuestSummaryView } from "./guests.types";

/**
 * Guest profiles are organization data (docs/DOMAIN_MODEL.md §2): any user
 * holding guests:read at any property of the organization may search them.
 * Phase 2 covers search / select / create for reservations; full profile
 * management (documents, preferences, merge) comes with the profiles phase.
 */

export async function searchGuests(
  ctx: SessionContext,
  query: GuestSearchQuery,
): Promise<GuestSummaryView[]> {
  if (!hasPermissionAnywhere(ctx.access, "guests:read")) throw forbidden("guests:read");
  const rows = await searchGuestRows(
    prisma,
    ctx.organizationId,
    {
      nameTokens: normalizeName(query.q).split(" ").filter(Boolean).slice(0, 5),
      raw: query.q.trim(),
      digits: query.q.replace(/\D/g, ""),
    },
    query.limit,
  );
  return rows.map(toGuestSummary);
}

export async function getGuest(ctx: SessionContext, guestId: string): Promise<GuestSummaryView> {
  if (!hasPermissionAnywhere(ctx.access, "guests:read")) throw forbidden("guests:read");
  const row = await findGuest(prisma, ctx.organizationId, guestId);
  if (!row) throw notFound("Guest");
  return toGuestSummary(row);
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

export async function createGuest(
  ctx: SessionContext,
  input: CreateGuestInput,
): Promise<GuestSummaryView> {
  if (!hasPermissionAnywhere(ctx.access, "guests:create")) throw forbidden("guests:create");
  return runInTransaction(async (tx) => {
    const profileNumber = await newProfileNumber(tx, ctx.organizationId);
    const row = await insertGuest(tx, {
      organizationId: ctx.organizationId,
      profileNumber,
      title: input.title ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      searchName: guestSearchName(input.firstName, input.lastName),
      primaryEmail: input.email ?? null,
      primaryPhone: input.phone ?? null,
      nationalityCode: input.nationalityCode ?? null,
      languageCode: input.languageCode ?? null,
    });
    const view = toGuestSummary(row);
    await recordAudit(tx, auditActor(ctx), {
      action: "guest.create",
      resourceType: "Guest",
      resourceId: row.id,
      after: { profileNumber, name: view.fullName, email: view.email, phone: view.phone },
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
