import "server-only";
import { prisma } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type SessionContext } from "@/lib/http/context";
import { AppError, forbidden, notFound } from "@/lib/http/errors";
import { type Permission, isPermission } from "@/lib/permissions/catalog";
import {
  hasOrganizationPermission,
  hasPermission,
  hasPermissionAnywhere,
  permissionsInScope,
  propertiesWithPermission,
} from "@/lib/permissions/evaluate";
import { serverEnv } from "@/lib/env";
import { type GrantedPermissions, loadGrantedPermissions } from "@/modules/access/access.service";
import { recordAudit } from "@/modules/audit/audit.service";
import {
  issuePasswordResetInTx,
  revokeAllSessionsForUser,
} from "@/modules/identity/identity.service";
import type { OffsetPageMeta } from "@/types/api";
import type { Tx } from "@/lib/db/prisma";
import {
  countOrganizationAdministrators,
  deleteRoleAssignment,
  findOrganizationRole,
  findPropertyInOrganization,
  findRoleAssignment,
  findRolesWithPermissions,
  findUserInOrganization,
  findUserAuthority,
  findUsersPage,
  insertRoleAssignment,
  lockOrganization,
  updateUserStatus,
  type UserRow,
} from "./users.repository";
import type { GrantRoleInput, ListUsersQuery, ReasonOnlyInput } from "./users.schema";
import type { PasswordResetIssued, RoleAssignmentView, RoleView, UserView } from "./users.types";

/**
 * Users are organization data: any holder of `users:read` (org or property
 * grant) may list them, but each user's role assignments are shown only for
 * the scopes the caller may inspect (D3): organization-scope grants need
 * `users:read`/`users:manage` at organization level, a property's grants
 * need them at that property.
 */
export async function listUsers(
  ctx: SessionContext,
  query: ListUsersQuery,
): Promise<{ items: UserView[]; meta: OffsetPageMeta }> {
  if (
    !hasPermissionAnywhere(ctx.access, "users:read") &&
    !hasPermissionAnywhere(ctx.access, "users:manage")
  ) {
    throw forbidden("users:read");
  }
  const { rows, total } = await findUsersPage(prisma, ctx.organizationId, query);
  return {
    items: rows.map((row) => toUserView(row, inspectableScopes(ctx))),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function listRoles(ctx: SessionContext): Promise<RoleView[]> {
  if (
    !hasPermissionAnywhere(ctx.access, "users:read") &&
    !hasPermissionAnywhere(ctx.access, "users:manage")
  ) {
    throw forbidden("users:read");
  }
  const roles = await findRolesWithPermissions(prisma, ctx.organizationId);
  return roles.map((role) => ({
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    permissions: role.permissions
      .map((p) => p.permissionKey)
      .filter(isPermission)
      .sort(),
  }));
}

/**
 * Grants a role organization-wide or for one property (docs/RBAC.md §6).
 * The target property comes from the body, so it is authorized here:
 * the caller needs `users:manage` in exactly that scope, may not change their
 * own grants, and may only grant permissions they hold themselves.
 */
export async function grantRole(
  ctx: SessionContext,
  userId: string,
  input: GrantRoleInput,
): Promise<UserView> {
  const propertyId = input.scope === "PROPERTY" ? input.propertyId : null;
  assertCanManageScope(ctx, propertyId);
  if (userId === ctx.userId)
    throw new AppError("FORBIDDEN", "You cannot change your own role assignments");

  return runInTransaction(async (tx) => {
    await lockAdministration(tx, ctx);
    const user = await findUserInOrganization(tx, ctx.organizationId, userId);
    if (!user) throw notFound("User");
    if (propertyId && !(await findPropertyInOrganization(tx, ctx.organizationId, propertyId))) {
      throw new AppError("FORBIDDEN", "You do not have access to this property");
    }
    const role = await findOrganizationRole(tx, ctx.organizationId, input.roleId);
    if (!role) throw notFound("Role");
    assertNoEscalation(
      ctx,
      propertyId,
      role.permissions.map((p) => p.permissionKey),
    );

    const assignment = await insertRoleAssignment(tx, {
      userId,
      roleId: role.id,
      scope: input.scope,
      propertyId,
      grantedById: ctx.userId,
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx), propertyId },
      {
        action: "user.role_grant",
        resourceType: "UserRoleAssignment",
        resourceId: assignment.id,
        risk: "HIGH",
        after: { userId, role: role.code, scope: input.scope, propertyId },
        reason: input.reason,
        reasonCodeId: input.reasonCodeId ?? null,
        permission: "users:manage",
      },
    );
    return reloadUser(tx, ctx, userId);
  });
}

export async function revokeRole(
  ctx: SessionContext,
  userId: string,
  assignmentId: string,
  input: ReasonOnlyInput,
): Promise<UserView> {
  if (userId === ctx.userId)
    throw new AppError("FORBIDDEN", "You cannot change your own role assignments");

  return runInTransaction(async (tx) => {
    await lockAdministration(tx, ctx);
    const user = await findUserInOrganization(tx, ctx.organizationId, userId);
    if (!user) throw notFound("User");
    const assignment = await findRoleAssignment(tx, userId, assignmentId);
    if (!assignment) throw notFound("Role assignment");
    const propertyId = assignment.scope === "PROPERTY" ? assignment.propertyId : null;
    assertCanManageScope(ctx, propertyId);
    // A lesser administrator cannot strip a role more powerful than their own.
    assertNoEscalation(
      ctx,
      propertyId,
      assignment.role.permissions.map((p) => p.permissionKey),
    );

    if (assignment.scope === "ORGANIZATION") {
      await assertKeepsAnAdministrator(tx, ctx.organizationId, {
        excludeAssignmentId: assignment.id,
      });
    }
    await deleteRoleAssignment(tx, assignment.id);
    await recordAudit(
      tx,
      { ...auditActor(ctx), propertyId },
      {
        action: "user.role_revoke",
        resourceType: "UserRoleAssignment",
        resourceId: assignment.id,
        risk: "HIGH",
        before: { userId, role: assignment.role.code, scope: assignment.scope, propertyId },
        reason: input.reason,
        reasonCodeId: input.reasonCodeId ?? null,
        permission: "users:manage",
      },
    );
    return reloadUser(tx, ctx, userId);
  });
}

/**
 * Disables a user everywhere and signs out all of their sessions immediately.
 * The caller must outrank the target (hold every permission the target holds,
 * in every scope) and the organization must keep an active administrator
 * (H3). Serialized per organization, so concurrent disables cannot both pass.
 */
export async function disableUser(
  ctx: SessionContext,
  userId: string,
  input: ReasonOnlyInput,
): Promise<UserView> {
  if (!hasOrganizationPermission(ctx.access, "users:manage")) throw forbidden("users:manage");
  if (userId === ctx.userId) throw new AppError("FORBIDDEN", "You cannot disable your own account");

  return runInTransaction(async (tx) => {
    const caller = await lockAdministration(tx, ctx);
    requireOrganizationUsersManage(caller);
    const user = await findUserInOrganization(tx, ctx.organizationId, userId);
    if (!user) throw notFound("User");
    if (user.status === "DISABLED") return toUserView(user, inspectableScopes(ctx));
    await assertOutranks(tx, ctx.organizationId, caller, userId);
    await assertKeepsAnAdministrator(tx, ctx.organizationId, { excludeUserId: userId });
    const now = new Date();
    const updated = await updateUserStatus(tx, userId, { status: "DISABLED" });
    const count = await revokeAllSessionsForUser(tx, userId, "USER_DISABLED", now);
    await recordAudit(tx, auditActor(ctx), {
      action: "user.disable",
      resourceType: "User",
      resourceId: userId,
      risk: "HIGH",
      before: { status: user.status },
      after: { status: "DISABLED", sessionsRevoked: count },
      reason: input.reason,
      permission: "users:manage",
    });
    return toUserView(updated, inspectableScopes(ctx));
  });
}

/**
 * Re-enables a DISABLED user (H3 recovery path). Only a caller who outranks
 * the target may do it. Failed sign-ins and lockout are cleared and any
 * session left is revoked, so the user must sign in afresh. Distinct from
 * `unlockUser`, which clears a lockout of an account that is not disabled.
 */
export async function enableUser(
  ctx: SessionContext,
  userId: string,
  input: ReasonOnlyInput,
): Promise<UserView> {
  if (!hasOrganizationPermission(ctx.access, "users:manage")) throw forbidden("users:manage");
  if (userId === ctx.userId) throw new AppError("FORBIDDEN", "You cannot enable your own account");

  return runInTransaction(async (tx) => {
    const caller = await lockAdministration(tx, ctx);
    requireOrganizationUsersManage(caller);
    const user = await findUserInOrganization(tx, ctx.organizationId, userId);
    if (!user) throw notFound("User");
    if (user.status !== "DISABLED") {
      throw new AppError("BUSINESS_RULE_VIOLATION", "Only a disabled user can be enabled", {
        reason: "USER_NOT_DISABLED",
      });
    }
    await assertOutranks(tx, ctx.organizationId, caller, userId);
    const now = new Date();
    const updated = await updateUserStatus(tx, userId, {
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
    });
    const count = await revokeAllSessionsForUser(tx, userId, "USER_REENABLED", now);
    await recordAudit(tx, auditActor(ctx), {
      action: "user.enable",
      resourceType: "User",
      resourceId: userId,
      risk: "HIGH",
      before: { status: "DISABLED" },
      after: { status: "ACTIVE", sessionsRevoked: count },
      reason: input.reason,
      permission: "users:manage",
    });
    return toUserView(updated, inspectableScopes(ctx));
  });
}

/** Clears an automatic lockout (and a LOCKED status) so the user can sign in again. */
export async function unlockUser(
  ctx: SessionContext,
  userId: string,
  input: ReasonOnlyInput,
): Promise<UserView> {
  if (!hasOrganizationPermission(ctx.access, "users:manage")) throw forbidden("users:manage");

  return runInTransaction(async (tx) => {
    const caller = await lockAdministration(tx, ctx);
    requireOrganizationUsersManage(caller);
    const user = await findUserInOrganization(tx, ctx.organizationId, userId);
    if (!user) throw notFound("User");
    if (user.status === "DISABLED" || user.status === "INVITED") {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        `A ${user.status.toLowerCase()} user cannot be unlocked`,
      );
    }
    if (userId !== ctx.userId) await assertOutranks(tx, ctx.organizationId, caller, userId);
    const updated = await updateUserStatus(tx, userId, {
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
    });
    await recordAudit(tx, auditActor(ctx), {
      action: "user.unlock",
      resourceType: "User",
      resourceId: userId,
      risk: "HIGH",
      before: { status: user.status, lockedUntil: user.lockedUntil?.toISOString() ?? null },
      after: { status: "ACTIVE" },
      reason: input.reason,
      permission: "users:manage",
    });
    return toUserView(updated, inspectableScopes(ctx));
  });
}

/**
 * Administrator-initiated password reset (H4). The caller must outrank the
 * target. The old password stops working, every session is revoked and a
 * single-use link valid for 30 minutes is returned ONCE in this response (no
 * e-mail infrastructure yet): the administrator hands it to the user. Only a
 * keyed hash of the token is stored; the token never reaches logs or audit.
 */
export async function issuePasswordReset(
  ctx: SessionContext,
  userId: string,
  input: ReasonOnlyInput,
): Promise<PasswordResetIssued> {
  if (!hasOrganizationPermission(ctx.access, "users:manage")) throw forbidden("users:manage");
  if (userId === ctx.userId) {
    throw new AppError("FORBIDDEN", "Change your own password from your account menu");
  }

  return runInTransaction(async (tx) => {
    const caller = await lockAdministration(tx, ctx);
    requireOrganizationUsersManage(caller);
    const user = await findUserInOrganization(tx, ctx.organizationId, userId);
    if (!user) throw notFound("User");
    if (user.status !== "ACTIVE" && user.status !== "LOCKED") {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        `A ${user.status.toLowerCase()} user cannot receive a password reset`,
        { reason: "USER_NOT_ACTIVE" },
      );
    }
    await assertOutranks(tx, ctx.organizationId, caller, userId);
    const now = new Date();
    const issued = await issuePasswordResetInTx(tx, userId, now);
    await recordAudit(tx, auditActor(ctx), {
      action: "user.password_reset_issue",
      resourceType: "User",
      resourceId: userId,
      risk: "HIGH",
      after: {
        tokenId: issued.tokenId,
        expiresAt: issued.expiresAt.toISOString(),
        sessionsRevoked: issued.sessionsRevoked,
      },
      reason: input.reason,
      permission: "users:manage",
    });
    const url = new URL("/reset-password", serverEnv().APP_URL);
    // The token travels in the fragment: browsers never send it to a server,
    // so it cannot end up in access logs or Referer headers.
    url.hash = `token=${issued.token}`;
    return {
      userId,
      resetUrl: url.toString(),
      expiresAt: issued.expiresAt.toISOString(),
      sessionsRevoked: issued.sessionsRevoked,
    };
  });
}

// --- Administration guards (H3) -----------------------------------------------------------

interface CallerAuthority extends GrantedPermissions {
  isSuperAdmin: boolean;
}

/**
 * Takes the organization's administration lock, then re-reads the caller
 * inside it: an administrator disabled or demoted by a concurrent command
 * can no longer act, whatever their request's access profile said.
 */
async function lockAdministration(tx: Tx, ctx: SessionContext): Promise<CallerAuthority> {
  await lockOrganization(tx, ctx.organizationId);
  const caller = await findUserAuthority(tx, ctx.organizationId, ctx.userId);
  if (!caller || caller.status !== "ACTIVE") throw forbidden("users:manage");
  const grants = await loadGrantedPermissions(tx, ctx.userId, ctx.organizationId);
  return { isSuperAdmin: caller.isSuperAdmin, ...grants };
}

/** Re-checked inside the lock: the grant may have been revoked concurrently. */
function requireOrganizationUsersManage(caller: CallerAuthority) {
  if (!caller.isSuperAdmin && !caller.organizationPermissions.has("users:manage")) {
    throw forbidden("users:manage");
  }
}

/**
 * The caller must hold every permission the target holds, in every scope the
 * target holds it (an organization grant covers every property). A platform
 * super admin can only be managed by another super admin.
 */
async function assertOutranks(
  tx: Tx,
  organizationId: string,
  caller: CallerAuthority,
  targetUserId: string,
) {
  if (caller.isSuperAdmin) return;
  const target = await findUserAuthority(tx, organizationId, targetUserId);
  if (!target) throw notFound("User");
  if (target.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Only a platform administrator can manage this user");
  }
  const granted = await loadGrantedPermissions(tx, targetUserId, organizationId);
  const missing = new Set<string>();
  for (const permission of granted.organizationPermissions) {
    if (!caller.organizationPermissions.has(permission)) missing.add(permission);
  }
  for (const [propertyId, permissions] of granted.propertyGrants) {
    const held = caller.propertyGrants.get(propertyId);
    for (const permission of permissions) {
      if (!caller.organizationPermissions.has(permission) && !held?.has(permission)) {
        missing.add(permission);
      }
    }
  }
  if (missing.size > 0) {
    throw new AppError("FORBIDDEN", "You cannot manage a user with permissions you do not hold", {
      reason: "TARGET_OUTRANKS_CALLER",
      missingPermissions: [...missing].sort(),
    });
  }
}

/**
 * Refuses a change that would leave the organization without an ACTIVE
 * administrator (users, roles and properties management at organization
 * scope, or a platform super admin). Runs under the organization lock.
 */
async function assertKeepsAnAdministrator(
  tx: Tx,
  organizationId: string,
  change: { excludeUserId?: string; excludeAssignmentId?: string },
) {
  const before = await countOrganizationAdministrators(tx, organizationId);
  if (before === 0) return; // Nothing left to protect; do not block unrelated changes.
  const after = await countOrganizationAdministrators(tx, organizationId, change);
  if (after === 0) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The organization must keep at least one active administrator",
      { reason: "LAST_ADMINISTRATOR" },
    );
  }
}

function assertCanManageScope(ctx: SessionContext, propertyId: string | null) {
  const allowed =
    propertyId === null
      ? hasOrganizationPermission(ctx.access, "users:manage")
      : hasPermission(ctx.access, propertyId, "users:manage");
  if (!allowed) {
    // A property outside the caller's access is reported as forbidden, never "not found".
    throw propertyId === null
      ? forbidden("users:manage")
      : new AppError("FORBIDDEN", "You do not have access to this property");
  }
}

/** No privilege escalation: every permission in the role must already be held in that scope. */
function assertNoEscalation(
  ctx: SessionContext,
  propertyId: string | null,
  rolePermissions: string[],
) {
  if (ctx.access.isSuperAdmin) return;
  const held = new Set<Permission>(permissionsInScope(ctx.access, propertyId));
  const missing = rolePermissions.filter((p) => !isPermission(p) || !held.has(p));
  if (missing.length > 0) {
    throw new AppError(
      "FORBIDDEN",
      "You cannot grant or revoke permissions you do not hold yourself",
      {
        missingPermissions: missing.sort(),
      },
    );
  }
}

async function reloadUser(
  tx: Parameters<typeof findUserInOrganization>[0],
  ctx: SessionContext,
  userId: string,
) {
  const user = await findUserInOrganization(tx, ctx.organizationId, userId);
  if (!user) throw notFound("User");
  return toUserView(user, inspectableScopes(ctx));
}

interface InspectableScopes {
  organization: boolean;
  propertyIds: ReadonlySet<string>;
}

/** Scopes whose role assignments the caller may see (`users:read` or `users:manage` there). */
function inspectableScopes(ctx: SessionContext): InspectableScopes {
  const organization =
    hasOrganizationPermission(ctx.access, "users:read") ||
    hasOrganizationPermission(ctx.access, "users:manage");
  return {
    organization,
    propertyIds: new Set([
      ...propertiesWithPermission(ctx.access, "users:read"),
      ...propertiesWithPermission(ctx.access, "users:manage"),
    ]),
  };
}

function toUserView(row: UserRow, visible: InspectableScopes): UserView {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    lockedUntil: row.lockedUntil?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    assignments: row.roleAssignments
      .filter((a) =>
        a.scope === "ORGANIZATION"
          ? visible.organization
          : visible.organization || (a.property !== null && visible.propertyIds.has(a.property.id)),
      )
      .map((a): RoleAssignmentView => ({
        id: a.id,
        scope: a.scope,
        role: a.role,
        property: a.property,
        createdAt: a.createdAt.toISOString(),
      })),
  };
}
