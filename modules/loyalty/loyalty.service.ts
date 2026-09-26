import "server-only";
import { randomInt } from "node:crypto";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type SessionContext } from "@/lib/http/context";
import { AppError, forbidden, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasOrganizationPermission, hasPermissionAnywhere } from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { recordAudit } from "@/modules/audit/audit.service";
import { guestFullName } from "@/modules/guests/guests.policy";
import { lockGuest } from "@/modules/guests/guests.repository";
import { getGuest } from "@/modules/guests/guests.service";
import type { GuestProfileView } from "@/modules/guests/guests.types";
import {
  adjustedBalance,
  membershipChangeProblem,
  membershipNumber,
  parsePoints,
} from "./loyalty.policy";
import {
  findMembersPage,
  findMembershipOfGuest,
  findProgram,
  findPrograms,
  findTier,
  insertChange,
  insertMembership,
  insertProgram,
  insertTier,
  insertTransaction,
  lockMembership,
  membershipNumberTaken,
  programCodeTaken,
  tierCodeTaken,
  updateMembershipVersioned,
  updateProgramRow,
  updateTierRow,
} from "./loyalty.repository";
import type {
  ChangeMembershipInput,
  CreateProgramInput,
  CreateTierInput,
  EnrollInput,
  MembersQuery,
  PointsAdjustmentInput,
  UpdateProgramInput,
  UpdateTierInput,
} from "./loyalty.schema";
import type { LoyaltyMembersPage, LoyaltyOverview } from "./loyalty.types";

/**
 * Loyalty foundation (organization data). Points are whole numbers held in
 * the membership balance and the append-only transaction ledger; changes of
 * tier and status are kept in the append-only membership history. No points
 * are earned automatically yet: that needs a reliable stay event (Phase 8).
 */

const can = (ctx: SessionContext, permission: Permission) =>
  hasPermissionAnywhere(ctx.access, permission);

function requirePermission(ctx: SessionContext, permission: Permission) {
  if (!can(ctx, permission)) throw forbidden(permission);
}

/**
 * Programs, tiers, membership tier/status and points are organization data
 * shared by every property (D3): they need the grant at organization scope.
 * Enrolment stays open to property staff holding loyalty:manage.
 */
function requireOrganizationPermission(ctx: SessionContext, permission: Permission) {
  if (!hasOrganizationPermission(ctx.access, permission)) {
    throw new AppError("FORBIDDEN", "This change needs an organization-level loyalty grant", {
      permission,
      reason: "ORGANIZATION_SCOPE_REQUIRED",
    });
  }
}

function rule(message: string, reason: string) {
  return new AppError("BUSINESS_RULE_VIOLATION", message, { reason });
}

function conflict(message: string, reason: string, field?: string) {
  return new AppError("CONFLICT", message, {
    reason,
    ...(field ? { fields: { [field]: [message] } } : {}),
  });
}

// --- Programs and tiers --------------------------------------------------------------------

export async function loyaltyOverview(ctx: SessionContext): Promise<LoyaltyOverview> {
  requirePermission(ctx, "loyalty:read");
  const programs = await findPrograms(prisma, ctx.organizationId);
  return {
    programs: programs.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      isExternal: p.isExternal,
      status: p.status,
      members: p._count.memberships,
      tiers: p.tiers.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        rank: t.rank,
        qualifyingNights: t.qualifyingNights,
        qualifyingStays: t.qualifyingStays,
        status: t.status,
        members: t._count.memberships,
      })),
    })),
    actions: { manage: hasOrganizationPermission(ctx.access, "loyalty:manage") },
  };
}

export async function createProgram(
  ctx: SessionContext,
  input: CreateProgramInput,
): Promise<LoyaltyOverview> {
  requireOrganizationPermission(ctx, "loyalty:manage");
  await runInTransaction(async (tx) => {
    if ((await programCodeTaken(tx, ctx.organizationId, input.code)) > 0) {
      throw conflict(`Code ${input.code} is already used`, "CODE_TAKEN", "code");
    }
    const { id } = await insertProgram(tx, {
      organizationId: ctx.organizationId,
      code: input.code,
      name: input.name,
      isExternal: input.isExternal,
    });
    await recordAudit(tx, auditActor(ctx), {
      action: "loyalty.program_create",
      resourceType: "LoyaltyProgram",
      resourceId: id,
      risk: "HIGH",
      after: { code: input.code, name: input.name, isExternal: input.isExternal },
      reason: input.reason,
      permission: "loyalty:manage",
    });
  });
  return loyaltyOverview(ctx);
}

export async function updateProgram(
  ctx: SessionContext,
  programId: string,
  input: UpdateProgramInput,
): Promise<LoyaltyOverview> {
  requireOrganizationPermission(ctx, "loyalty:manage");
  await runInTransaction(async (tx) => {
    const program = await findProgram(tx, ctx.organizationId, programId);
    if (!program) throw notFound("Loyalty program");
    await updateProgramRow(tx, programId, { name: input.name, status: input.status });
    await recordAudit(tx, auditActor(ctx), {
      action: "loyalty.program_update",
      resourceType: "LoyaltyProgram",
      resourceId: programId,
      risk: "HIGH",
      before: { name: program.name, status: program.status },
      after: { name: input.name ?? program.name, status: input.status ?? program.status },
      reason: input.reason,
      permission: "loyalty:manage",
    });
  });
  return loyaltyOverview(ctx);
}

export async function createTier(
  ctx: SessionContext,
  programId: string,
  input: CreateTierInput,
): Promise<LoyaltyOverview> {
  requireOrganizationPermission(ctx, "loyalty:manage");
  await runInTransaction(async (tx) => {
    const program = await findProgram(tx, ctx.organizationId, programId);
    if (!program) throw notFound("Loyalty program");
    if ((await tierCodeTaken(tx, programId, input.code)) > 0) {
      throw conflict(`Tier ${input.code} already exists`, "CODE_TAKEN", "code");
    }
    const { id } = await insertTier(tx, {
      programId,
      code: input.code,
      name: input.name,
      rank: input.rank,
      qualifyingNights: input.qualifyingNights ?? null,
      qualifyingStays: input.qualifyingStays ?? null,
    });
    await recordAudit(tx, auditActor(ctx), {
      action: "loyalty.tier_create",
      resourceType: "LoyaltyProgram",
      resourceId: programId,
      risk: "HIGH",
      after: { tierId: id, code: input.code, name: input.name, rank: input.rank },
      reason: input.reason,
      permission: "loyalty:manage",
    });
  });
  return loyaltyOverview(ctx);
}

export async function updateTier(
  ctx: SessionContext,
  tierId: string,
  input: UpdateTierInput,
): Promise<LoyaltyOverview> {
  requireOrganizationPermission(ctx, "loyalty:manage");
  await runInTransaction(async (tx) => {
    const tier = await findTier(tx, ctx.organizationId, tierId);
    if (!tier) throw notFound("Tier");
    const data = {
      name: input.name,
      rank: input.rank,
      qualifyingNights: input.qualifyingNights,
      qualifyingStays: input.qualifyingStays,
      status: input.status,
    };
    await updateTierRow(tx, tierId, data);
    await recordAudit(tx, auditActor(ctx), {
      action: "loyalty.tier_update",
      resourceType: "LoyaltyProgram",
      resourceId: tier.programId,
      risk: "HIGH",
      before: {
        tierId,
        name: tier.name,
        rank: tier.rank,
        qualifyingNights: tier.qualifyingNights,
        qualifyingStays: tier.qualifyingStays,
        status: tier.status,
      },
      after: { tierId, ...data },
      reason: input.reason,
      permission: "loyalty:manage",
    });
  });
  return loyaltyOverview(ctx);
}

export async function listMembers(
  ctx: SessionContext,
  programId: string,
  query: MembersQuery,
): Promise<LoyaltyMembersPage> {
  requirePermission(ctx, "loyalty:read");
  requirePermission(ctx, "guests:read");
  const program = await findProgram(prisma, ctx.organizationId, programId);
  if (!program) throw notFound("Loyalty program");
  let after: { enrolledAt: Date; id: string } | null = null;
  if (query.cursor) {
    const c = decodeCursor(query.cursor, ["e", "i"] as const);
    const at = c ? new Date(c.e) : null;
    if (!c || !at || Number.isNaN(at.getTime())) {
      throw new AppError("VALIDATION_FAILED", "Invalid cursor", {
        fields: { cursor: ["Invalid cursor"] },
      });
    }
    after = { enrolledAt: at, id: c.i };
  }
  const rows = await findMembersPage(prisma, programId, after, query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((m) => ({
      membershipId: m.id,
      membershipNumber: m.membershipNumber,
      guest: {
        id: m.guest.id,
        profileNumber: m.guest.profileNumber,
        fullName: guestFullName(m.guest),
      },
      tier: m.tier?.name ?? null,
      status: m.status,
      pointsBalance: m.pointsBalance.toFixed(0),
      enrolledAt: m.enrolledAt.toISOString(),
    })),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ e: last.enrolledAt.toISOString(), i: last.id })
        : null,
  };
}

// --- Memberships ---------------------------------------------------------------------------

async function newMembershipNumber(tx: Tx, programId: string, programCode: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const digits = String(randomInt(10_000_000)).padStart(7, "0");
    const candidate = membershipNumber(programCode, digits);
    if ((await membershipNumberTaken(tx, programId, candidate)) === 0) return candidate;
  }
  throw new Error("Could not allocate a unique membership number");
}

export async function enrollGuest(
  ctx: SessionContext,
  guestId: string,
  input: EnrollInput,
): Promise<GuestProfileView> {
  requirePermission(ctx, "loyalty:manage");
  requirePermission(ctx, "guests:read");
  await runInTransaction(async (tx) => {
    // Enrollments of one guest serialize on the guest row; the unique
    // (program, guest) index backs this up.
    const guest = await lockGuest(tx, ctx.organizationId, guestId);
    if (!guest) throw notFound("Guest");
    if (guest.status !== "ACTIVE")
      throw rule("Only active profiles can be enrolled", "GUEST_INACTIVE");
    const program = await findProgram(tx, ctx.organizationId, input.programId);
    if (!program) throw notFound("Loyalty program");
    if (program.status !== "ACTIVE") throw rule("The program is not active", "PROGRAM_INACTIVE");
    if (await findMembershipOfGuest(tx, program.id, guestId)) {
      throw conflict(
        "The guest is already a member of this program; re-activate the membership instead",
        "ALREADY_ENROLLED",
      );
    }
    if (input.tierId) {
      const tier = await findTier(tx, ctx.organizationId, input.tierId);
      if (!tier || tier.programId !== program.id) throw notFound("Tier");
      if (tier.status !== "ACTIVE") throw rule("The tier is not active", "TIER_INACTIVE");
    }
    let number: string;
    if (program.isExternal) {
      if (!input.membershipNumber) {
        throw new AppError(
          "VALIDATION_FAILED",
          "Enter the member's number in the external program",
          {
            fields: { membershipNumber: ["Required for an external program"] },
          },
        );
      }
      number = input.membershipNumber;
      if ((await membershipNumberTaken(tx, program.id, number)) > 0) {
        throw conflict(
          `Membership number ${number} is already used`,
          "NUMBER_TAKEN",
          "membershipNumber",
        );
      }
    } else {
      number = await newMembershipNumber(tx, program.id, program.code);
    }
    const { id } = await insertMembership(tx, {
      programId: program.id,
      guestId,
      membershipNumber: number,
      tierId: input.tierId ?? null,
    });
    await insertChange(tx, {
      membershipId: id,
      type: "ENROLLED",
      toTierId: input.tierId ?? null,
      toStatus: "ACTIVE",
      reason: input.reason,
      createdById: ctx.userId,
    });
    await recordAudit(tx, auditActor(ctx), {
      action: "loyalty.enroll",
      resourceType: "LoyaltyMembership",
      resourceId: id,
      risk: "HIGH",
      after: {
        guestId,
        program: program.code,
        membershipNumber: number,
        tierId: input.tierId ?? null,
      },
      reason: input.reason,
      permission: "loyalty:manage",
    });
  });
  return getGuest(ctx, guestId);
}

export async function changeMembership(
  ctx: SessionContext,
  membershipId: string,
  input: ChangeMembershipInput,
): Promise<GuestProfileView> {
  requireOrganizationPermission(ctx, "loyalty:manage");
  const guestId = await runInTransaction(async (tx) => {
    const m = await lockMembership(tx, ctx.organizationId, membershipId);
    if (!m) throw notFound("Membership");
    if (m.version !== input.version) throw staleVersion("Membership");
    const tier = input.tierId ? await findTier(tx, ctx.organizationId, input.tierId) : null;
    const problem = membershipChangeProblem(
      { tierId: m.tier_id, status: m.status },
      { tierId: input.tierId, status: input.status },
      input.tierId
        ? tier
          ? { programMatches: tier.programId === m.program_id, active: tier.status === "ACTIVE" }
          : null
        : null,
    );
    if (problem) throw rule(problem, "INVALID_MEMBERSHIP_CHANGE");
    const tierChanges = input.tierId !== undefined && input.tierId !== m.tier_id;
    const statusChanges = input.status !== undefined && input.status !== m.status;
    const { count } = await updateMembershipVersioned(tx, membershipId, input.version, {
      tierId: tierChanges ? input.tierId : undefined,
      status: statusChanges ? input.status : undefined,
    });
    if (count !== 1) throw staleVersion("Membership");
    if (statusChanges) {
      await insertChange(tx, {
        membershipId,
        type: "STATUS_CHANGED",
        fromStatus: m.status,
        toStatus: input.status,
        reason: input.reason,
        createdById: ctx.userId,
      });
    }
    if (tierChanges) {
      await insertChange(tx, {
        membershipId,
        type: "TIER_CHANGED",
        fromTierId: m.tier_id,
        toTierId: input.tierId ?? null,
        reason: input.reason,
        createdById: ctx.userId,
      });
    }
    await recordAudit(tx, auditActor(ctx), {
      action: "loyalty.membership_change",
      resourceType: "LoyaltyMembership",
      resourceId: membershipId,
      risk: "HIGH",
      before: { tierId: m.tier_id, status: m.status },
      after: {
        tierId: tierChanges ? (input.tierId ?? null) : m.tier_id,
        status: statusChanges ? input.status : m.status,
      },
      reason: input.reason,
      permission: "loyalty:manage",
    });
    return m.guest_id;
  });
  return getGuest(ctx, guestId);
}

export async function adjustPoints(
  ctx: SessionContext,
  membershipId: string,
  input: PointsAdjustmentInput,
): Promise<GuestProfileView> {
  requireOrganizationPermission(ctx, "loyalty:manage");
  const points = parsePoints(input.points);
  if (points === null || points === 0n) {
    throw new AppError("VALIDATION_FAILED", "Enter whole points", {
      fields: { points: ["Whole points, not zero"] },
    });
  }
  const guestId = await runInTransaction(async (tx) => {
    const m = await lockMembership(tx, ctx.organizationId, membershipId);
    if (!m) throw notFound("Membership");
    if (m.version !== input.version) throw staleVersion("Membership");
    if (m.status !== "ACTIVE") throw rule("The membership is not active", "MEMBERSHIP_INACTIVE");
    const balance = BigInt(m.points_balance.split(".")[0]!);
    const next = adjustedBalance(balance, points);
    if (next === null) throw rule("The balance cannot go below zero", "INSUFFICIENT_POINTS");
    const { count } = await updateMembershipVersioned(tx, membershipId, input.version, {
      pointsBalance: next.toString(),
    });
    if (count !== 1) throw staleVersion("Membership");
    await insertTransaction(tx, {
      membershipId,
      type: "ADJUST",
      points: points.toString(),
      description: input.description,
      createdById: ctx.userId,
    });
    await recordAudit(tx, auditActor(ctx), {
      action: "loyalty.points_adjust",
      resourceType: "LoyaltyMembership",
      resourceId: membershipId,
      risk: "HIGH",
      before: { pointsBalance: balance.toString() },
      after: {
        pointsBalance: next.toString(),
        points: points.toString(),
        description: input.description,
      },
      reason: input.reason,
      permission: "loyalty:manage",
    });
    return m.guest_id;
  });
  return getGuest(ctx, guestId);
}
