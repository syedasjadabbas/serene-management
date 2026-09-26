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
import { recordAudit } from "@/modules/audit/audit.service";
import { revokeAllSessionsForUser } from "@/modules/identity/identity.service";
import type { OffsetPageMeta } from "@/types/api";
import {
  deleteRoleAssignment,
  findOrganizationRole,
  findPropertyInOrganization,
  findRoleAssignment,
  findRolesWithPermissions,
  findUserInOrganization,
  findUsersPage,
  insertRoleAssignment,
  updateUserStatus,
  type UserRow,
} from "./users.repository";
import type { GrantRoleInput, ListUsersQuery, ReasonOnlyInput } from "./users.schema";
import type { RoleAssignmentView, RoleView, UserView } from "./users.types";

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

/** Disables a user everywhere and signs out all of their sessions immediately. */
export async function disableUser(
  ctx: SessionContext,
  userId: string,
  input: ReasonOnlyInput,
): Promise<UserView> {
  if (!hasOrganizationPermission(ctx.access, "users:manage")) throw forbidden("users:manage");
  if (userId === ctx.userId) throw new AppError("FORBIDDEN", "You cannot disable your own account");

  return runInTransaction(async (tx) => {
    const user = await findUserInOrganization(tx, ctx.organizationId, userId);
    if (!user) throw notFound("User");
    if (user.status === "DISABLED") return toUserView(user, inspectableScopes(ctx));
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

/** Clears an automatic lockout (and a LOCKED status) so the user can sign in again. */
export async function unlockUser(
  ctx: SessionContext,
  userId: string,
  input: ReasonOnlyInput,
): Promise<UserView> {
  if (!hasOrganizationPermission(ctx.access, "users:manage")) throw forbidden("users:manage");

  return runInTransaction(async (tx) => {
    const user = await findUserInOrganization(tx, ctx.organizationId, userId);
    if (!user) throw notFound("User");
    if (user.status === "DISABLED" || user.status === "INVITED") {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        `A ${user.status.toLowerCase()} user cannot be unlocked`,
      );
    }
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
