import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type SessionContext } from "@/lib/http/context";
import { AppError, forbidden, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasPermissionAnywhere, propertiesWithPermission } from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { recordAudit, resourceHistory } from "@/modules/audit/audit.service";
import { toDateOnly } from "@/modules/business-date/business-date.policy";
import { guestFullName, normalizeName } from "@/modules/guests/guests.policy";
import { findGuestAnyStatus, findPropertiesByIds } from "@/modules/guests/guests.repository";
import { displayConfirmation } from "@/modules/reservations/reservations.policy";
import {
  type AccountRow,
  accountCodeTaken,
  deleteContact,
  findAccount,
  findAccountNegotiatedRates,
  findAccountReservations,
  findAccountsPage,
  findBookableAccount,
  findContact,
  insertAccount,
  isAccountContact,
  lockAccount,
  updateAccountVersioned,
  upsertContact,
} from "./accounts.repository";
import type {
  AccountContactInput,
  AccountsQuery,
  CreateAccountInput,
  UpdateAccountInput,
} from "./accounts.schema";
import type { AccountDetail, AccountListPage } from "./accounts.types";

/**
 * Company and travel-agent profiles are organization data (DOMAIN_MODEL §2):
 * accounts:read / accounts:manage held at any property apply. Reservations
 * and negotiated rates shown with an account come only from properties
 * where the caller may read them. Not an accounting system: AR numbers and
 * credit limits stay out of scope.
 */

const can = (ctx: SessionContext, permission: Permission) =>
  hasPermissionAnywhere(ctx.access, permission);

function requirePermission(ctx: SessionContext, permission: Permission) {
  if (!can(ctx, permission)) throw forbidden(permission);
}

function invalid(field: string, message: string) {
  return new AppError("VALIDATION_FAILED", message, { fields: { [field]: [message] } });
}

export async function listAccounts(
  ctx: SessionContext,
  query: AccountsQuery,
): Promise<AccountListPage> {
  requirePermission(ctx, "accounts:read");
  let after: { name: string; id: string } | null = null;
  if (query.cursor) {
    const c = decodeCursor(query.cursor, ["n", "i"] as const);
    if (!c) throw invalid("cursor", "Invalid cursor");
    after = { name: c.n, id: c.i };
  }
  const rows = await findAccountsPage(
    prisma,
    ctx.organizationId,
    {
      q: query.q ? normalizeName(query.q) : undefined,
      type: query.type,
      status: query.status,
    },
    after,
    query.limit + 1,
  );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      type: r.type,
      code: r.code,
      name: r.name,
      city: r.city,
      countryCode: r.countryCode,
      status: r.status,
      isRestricted: r.isRestricted,
      contacts: r._count.contacts,
    })),
    nextCursor:
      rows.length > query.limit && last ? encodeCursor({ n: last.name, i: last.id }) : null,
  };
}

export async function getAccount(ctx: SessionContext, accountId: string): Promise<AccountDetail> {
  requirePermission(ctx, "accounts:read");
  const row = await findAccount(prisma, ctx.organizationId, accountId);
  if (!row) throw notFound("Company");
  const [reservations, negotiated, history] = await Promise.all([
    findAccountReservations(
      prisma,
      accountId,
      propertiesWithPermission(ctx.access, "reservations:read"),
    ),
    findAccountNegotiatedRates(
      prisma,
      accountId,
      propertiesWithPermission(ctx.access, "rates:read"),
    ),
    can(ctx, "audit:read") ? resourceHistory(prisma, ctx.organizationId, [accountId], 50) : null,
  ]);
  const codes = new Map(
    (
      await findPropertiesByIds(prisma, ctx.organizationId, [
        ...new Set(reservations.map((r) => r.propertyId)),
      ])
    ).map((p) => [p.id, p.code]),
  );
  return toDetail(ctx, row, reservations, negotiated, history, codes);
}

export async function createAccount(
  ctx: SessionContext,
  input: CreateAccountInput,
): Promise<AccountDetail> {
  requirePermission(ctx, "accounts:manage");
  const id = await runInTransaction(async (tx) => {
    if ((await accountCodeTaken(tx, ctx.organizationId, input.type, input.code)) > 0) {
      throw new AppError("CONFLICT", `Code ${input.code} is already used`, {
        reason: "CODE_TAKEN",
        fields: { code: ["Already used"] },
      });
    }
    const { id } = await insertAccount(tx, {
      organizationId: ctx.organizationId,
      type: input.type,
      code: input.code,
      name: input.name,
      searchName: normalizeName(input.name),
      legalName: input.legalName ?? null,
      iataNumber: input.iataNumber ?? null,
      taxId: input.taxId ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      postalCode: input.postalCode ?? null,
      countryCode: input.countryCode ?? null,
      notes: input.notes ?? null,
    });
    await recordAudit(tx, auditActor(ctx), {
      action: "account.create",
      resourceType: "AccountProfile",
      resourceId: id,
      after: { type: input.type, code: input.code, name: input.name },
      permission: "accounts:manage",
    });
    return id;
  });
  return getAccount(ctx, id);
}

const AUDITED = [
  "name",
  "legalName",
  "iataNumber",
  "taxId",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "countryCode",
  "notes",
  "status",
  "isRestricted",
  "restrictionReason",
] as const;

export async function updateAccount(
  ctx: SessionContext,
  accountId: string,
  input: UpdateAccountInput,
): Promise<AccountDetail> {
  requirePermission(ctx, "accounts:manage");
  if ((input.isRestricted !== undefined || input.status !== undefined) && !input.reason) {
    throw invalid("reason", "A reason is required to change the restriction or status");
  }
  if (input.isRestricted && !input.restrictionReason) {
    throw invalid("restrictionReason", "Describe why the company is restricted");
  }
  await runInTransaction(async (tx) => {
    const locked = await lockAccount(tx, ctx.organizationId, accountId);
    if (!locked) throw notFound("Company");
    if (locked.version !== input.version) throw staleVersion("Company");
    const before = (await findAccount(tx, ctx.organizationId, accountId))!;
    const data = {
      name: input.name,
      searchName: input.name ? normalizeName(input.name) : undefined,
      legalName: input.legalName,
      iataNumber: input.iataNumber,
      taxId: input.taxId,
      email: input.email,
      phone: input.phone,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      region: input.region,
      postalCode: input.postalCode,
      countryCode: input.countryCode,
      notes: input.notes,
      status: input.status,
      isRestricted: input.isRestricted,
      restrictionReason:
        input.isRestricted === false ? null : (input.restrictionReason ?? undefined),
    };
    const { count } = await updateAccountVersioned(tx, accountId, input.version, data);
    if (count !== 1) throw staleVersion("Company");
    const beforeAudit: Record<string, unknown> = {};
    const afterAudit: Record<string, unknown> = {};
    for (const field of AUDITED) {
      const now = data[field];
      const was = before[field];
      if (now === undefined || (was ?? null) === (now ?? null)) continue;
      beforeAudit[field] = was ?? null;
      afterAudit[field] = now ?? null;
    }
    await recordAudit(tx, auditActor(ctx), {
      action: "account.update",
      resourceType: "AccountProfile",
      resourceId: accountId,
      risk: "isRestricted" in afterAudit || "status" in afterAudit ? "HIGH" : "STANDARD",
      before: beforeAudit,
      after: afterAudit,
      reason: input.reason ?? null,
      permission: "accounts:manage",
    });
  });
  return getAccount(ctx, accountId);
}

/** Creates or updates the guest's relationship with the account (one row per pair). */
export async function setAccountContact(
  ctx: SessionContext,
  accountId: string,
  guestId: string,
  input: AccountContactInput,
): Promise<AccountDetail> {
  requirePermission(ctx, "accounts:manage");
  requirePermission(ctx, "guests:read");
  await runInTransaction(async (tx) => {
    const locked = await lockAccount(tx, ctx.organizationId, accountId);
    if (!locked) throw notFound("Company");
    if (!(await findGuestAnyStatus(tx, ctx.organizationId, guestId))) throw notFound("Guest");
    const before = await findContact(tx, accountId, guestId);
    const data = { kind: input.kind, role: input.role ?? null, isPrimary: input.isPrimary };
    await upsertContact(tx, accountId, guestId, data);
    await recordAudit(tx, auditActor(ctx), {
      action: before ? "account.contact_update" : "account.contact_add",
      resourceType: "AccountProfile",
      resourceId: accountId,
      before: before ? { guestId, ...before } : null,
      after: { guestId, ...data },
      permission: "accounts:manage",
    });
  });
  return getAccount(ctx, accountId);
}

export async function removeAccountContact(
  ctx: SessionContext,
  accountId: string,
  guestId: string,
): Promise<AccountDetail> {
  requirePermission(ctx, "accounts:manage");
  await runInTransaction(async (tx) => {
    const locked = await lockAccount(tx, ctx.organizationId, accountId);
    if (!locked) throw notFound("Company");
    const before = await findContact(tx, accountId, guestId);
    if (!before) throw notFound("Relationship");
    await deleteContact(tx, accountId, guestId);
    await recordAudit(tx, auditActor(ctx), {
      action: "account.contact_remove",
      resourceType: "AccountProfile",
      resourceId: accountId,
      before: { guestId, ...before },
      permission: "accounts:manage",
    });
  });
  return getAccount(ctx, accountId);
}

/**
 * Validates a reservation's company (Phase 7): an active, unrestricted
 * company of the organization, and — when given — a booker who is one of its
 * contacts. Called inside the reservation transaction; never trusts the ids.
 */
export async function requireReservationCompany(
  tx: Tx,
  organizationId: string,
  companyId: string,
  bookerGuestId: string | null,
): Promise<{ id: string; code: string | null; name: string }> {
  const account = await findBookableAccount(tx, organizationId, companyId);
  if (!account) throw notFound("Company");
  if (account.isRestricted) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "This company is restricted from booking", {
      reason: "COMPANY_RESTRICTED",
    });
  }
  if (bookerGuestId && (await isAccountContact(tx, companyId, bookerGuestId)) === 0) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "The booker is not a contact of this company", {
      reason: "NOT_COMPANY_CONTACT",
      fields: { bookerGuestId: ["Not a contact of the company"] },
    });
  }
  return account;
}

function toDetail(
  ctx: SessionContext,
  row: AccountRow,
  reservations: Awaited<ReturnType<typeof findAccountReservations>>,
  negotiated: Awaited<ReturnType<typeof findAccountNegotiatedRates>>,
  history: AccountDetail["history"],
  propertyCodes: Map<string, string>,
): AccountDetail {
  const { contacts, createdAt, ...rest } = row;
  return {
    ...rest,
    contacts: can(ctx, "guests:read")
      ? contacts.map((c) => ({
          guest: {
            id: c.guest.id,
            profileNumber: c.guest.profileNumber,
            fullName: guestFullName(c.guest),
            email: c.guest.primaryEmail,
          },
          kind: c.kind,
          role: c.role,
          isPrimary: c.isPrimary,
        }))
      : null,
    reservations: reservations.map((r) => ({
      reservationId: r.reservationId,
      property: { id: r.propertyId, code: propertyCodes.get(r.propertyId) ?? "" },
      confirmation: displayConfirmation(
        r.reservation.confirmationNumber,
        r.lineNumber,
        r.reservation._count.rooms,
      ),
      guestName: guestFullName(r.primaryGuest),
      arrival: toDateOnly(r.arrivalDate),
      departure: toDateOnly(r.departureDate),
      status: r.status,
      ratePlan: r.ratePlan.code,
    })),
    negotiatedRates: negotiated.map((n) => ({
      property: n.ratePlan.property,
      ratePlan: { id: n.ratePlan.id, code: n.ratePlan.code, name: n.ratePlan.name },
      validFrom: n.validFrom ? toDateOnly(n.validFrom) : null,
      validTo: n.validTo ? toDateOnly(n.validTo) : null,
    })),
    history,
    createdAt: createdAt.toISOString(),
    actions: { manage: can(ctx, "accounts:manage") },
  };
}
