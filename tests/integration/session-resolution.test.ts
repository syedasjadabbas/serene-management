import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { GET as businessDateRoute } from "@/app/api/v1/properties/[propertyId]/business-date/route";
import { GET as auditLogsRoute } from "@/app/api/v1/properties/[propertyId]/audit-logs/route";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { type AccessTokenClaims, verifyAccessToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db/prisma";
import { serverEnv } from "@/lib/env";
import { type Permission, isPermission } from "@/lib/permissions/catalog";
import { resolveSession } from "@/modules/access/access.service";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  createCustomUser,
  createFixtureOrg,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";
import { countStatements } from "./support/statements";

/**
 * Session resolution in one statement (scalability phase 2, docs/SCALABILITY.md)
 * must decide exactly what the previous three statements decided. Two kinds of
 * evidence:
 *  1. a differential check against the previous algorithm (reproduced here
 *     verbatim) for every kind of grant layout;
 *  2. the security cases, each observed on the very next request (no cache).
 * Revocation on logout, disabling, password change, refresh rotation/reuse and
 * property-grant removal are covered in auth.test.ts, account-security.test.ts
 * and rbac-isolation.test.ts; they run against the same resolver.
 */

let org: FixtureOrg;
let other: FixtureOrg;
const LEGACY_KEY = "legacy:retired";

/** The previous resolver: three statements and the same JavaScript rules. */
async function previousResolution(claims: AccessTokenClaims) {
  const [session] = await prisma.$queryRaw<
    {
      id: string;
      revoked_at: Date | null;
      expires_at: Date;
      created_at: Date;
      user_id: string;
      organization_id: string;
      password_changed_at: Date | null;
      user_status: string;
      is_super_admin: boolean;
      organization_status: string;
    }[]
  >`
    SELECT s."id", s."revoked_at", s."expires_at", s."created_at",
           u."id" AS "user_id", u."organization_id", u."password_changed_at",
           u."status"::text AS "user_status", u."is_super_admin",
           o."status"::text AS "organization_status"
    FROM "auth_sessions" s
    JOIN "users" u ON u."id" = s."user_id"
    JOIN "organizations" o ON o."id" = u."organization_id"
    LEFT JOIN "user_avatars" ua ON ua."user_id" = u."id"
    WHERE s."id" = ${claims.sessionId}::uuid`;
  const now = new Date();
  if (!session || session.revoked_at || session.expires_at <= now) return null;
  if (session.user_id !== claims.userId || session.organization_id !== claims.organizationId)
    return null;
  if (session.user_status !== "ACTIVE" || session.organization_status !== "ACTIVE") return null;
  if (session.password_changed_at && session.created_at < session.password_changed_at) return null;

  const grants = await prisma.$queryRaw<
    { scope: string; property_id: string | null; permission_key: string }[]
  >`
    SELECT DISTINCT a."scope"::text AS "scope", a."property_id", rp."permission_key"
    FROM "user_role_assignments" a
    JOIN "roles" r ON r."id" = a."role_id"
    JOIN "role_permissions" rp ON rp."role_id" = r."id"
    LEFT JOIN "properties" p ON p."id" = a."property_id"
    WHERE a."user_id" = ${session.user_id}::uuid
      AND (r."organization_id" = ${session.organization_id}::uuid OR r."organization_id" IS NULL)
      AND (a."property_id" IS NULL OR (p."organization_id" = ${session.organization_id}::uuid AND p."status" = 'ACTIVE'))`;
  const organizationPermissions = new Set<Permission>();
  const propertyGrants = new Map<string, Set<Permission>>();
  for (const grant of grants) {
    if (!isPermission(grant.permission_key)) continue;
    if (grant.scope === "ORGANIZATION") organizationPermissions.add(grant.permission_key);
    else if (grant.property_id) {
      const set = propertyGrants.get(grant.property_id) ?? new Set<Permission>();
      set.add(grant.permission_key);
      propertyGrants.set(grant.property_id, set);
    }
  }
  const all = session.is_super_admin || organizationPermissions.size > 0;
  const ids = [...propertyGrants.keys()];
  const properties =
    !all && ids.length === 0
      ? []
      : await prisma.$queryRaw<{ id: string; code: string; business_date: string | null }[]>`
          SELECT p."id", p."code", bd."date"::text AS "business_date"
          FROM "properties" p
          LEFT JOIN "business_dates" bd ON bd."property_id" = p."id" AND bd."is_current"
          WHERE p."organization_id" = ${session.organization_id}::uuid AND p."status" = 'ACTIVE'
            AND (${all} OR p."id" = ANY(${ids}::uuid[]))
          ORDER BY p."code"`;
  const byProperty: Record<string, Permission[]> = {};
  for (const property of properties) {
    const merged = new Set(organizationPermissions);
    for (const permission of propertyGrants.get(property.id) ?? []) merged.add(permission);
    byProperty[property.id] = [...merged].sort();
  }
  return {
    organizationPermissions: [...organizationPermissions].sort(),
    byProperty,
    propertyCodes: properties.map((p) => p.code),
    businessDates: Object.fromEntries(properties.map((p) => [p.id, p.business_date])),
  };
}

async function claimsOf(jar: CookieJar): Promise<AccessTokenClaims> {
  const claims = await verifyAccessToken(jar.get(ACCESS_COOKIE));
  if (!claims) throw new Error("no valid access token");
  return claims;
}

async function sessionFor(email: string) {
  const jar = await loginAs(email, TEST_PASSWORD);
  return { jar, claims: await claimsOf(jar) };
}

async function expectSameAsBefore(claims: AccessTokenClaims) {
  const current = await resolveSession(claims);
  const previous = await previousResolution(claims);
  if (previous === null) {
    expect(current).toBeNull();
    return current;
  }
  expect(current).not.toBeNull();
  expect({
    organizationPermissions: current!.access.organizationPermissions,
    byProperty: current!.access.byProperty,
    propertyCodes: current!.properties.map((p) => p.code),
    businessDates: current!.businessDates,
  }).toEqual(previous);
  return current;
}

const me = (jar: CookieJar) => call(meRoute, { path: "/api/v1/me", jar });
const businessDate = (jar: CookieJar, propertyId: string) =>
  call(businessDateRoute, {
    path: `/api/v1/properties/${propertyId}/business-date`,
    params: { propertyId },
    jar,
  });
const auditLogs = (jar: CookieJar, propertyId: string) =>
  call(auditLogsRoute, {
    path: `/api/v1/properties/${propertyId}/audit-logs`,
    params: { propertyId },
    jar,
  });

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
      { key: "C", timezone: "Asia/Karachi" },
    ],
  });
  other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
  await prisma.permission.upsert({
    where: { key: LEGACY_KEY },
    create: { key: LEGACY_KEY, resource: "legacy", action: "retired", description: "Test only" },
    update: {},
  });
}, 120_000);

describe("one-statement session resolution matches the previous resolver", () => {
  it("for organization, property, mixed, super-admin and grant-less users", async () => {
    const users = {
      admin: await prisma.user.findUniqueOrThrow({
        where: { id: org.adminId },
        select: { email: true },
      }),
      property: await createCustomUser(org, "sr-prop", [
        { permissions: ["frontdesk:read"], property: "A" },
      ]),
      mixed: await createCustomUser(org, "sr-mixed", [
        { permissions: ["guests:read"] },
        { permissions: ["frontdesk:read", "billing:read"], property: "B" },
      ]),
      twoProperties: await createCustomUser(org, "sr-two", [
        { permissions: ["frontdesk:read"], property: "A" },
        { permissions: ["rooms:read"], property: "B" },
      ]),
      none: await createCustomUser(org, "sr-none", []),
    };
    const superAdmin = await createCustomUser(org, "sr-super", []);
    await prisma.user.update({ where: { id: superAdmin.id }, data: { isSuperAdmin: true } });

    for (const [name, user] of Object.entries({ ...users, superAdmin })) {
      const { claims } = await sessionFor(user.email);
      const resolved = await expectSameAsBefore(claims);
      expect(resolved, name).not.toBeNull();
    }
    const property = await resolveSession((await sessionFor(users.property.email)).claims);
    expect(property!.properties.map((p) => p.id)).toEqual([org.properties.A!.id]);
    const sup = await resolveSession((await sessionFor(superAdmin.email)).claims);
    expect(sup!.properties).toHaveLength(3);
    const none = await resolveSession((await sessionFor(users.none.email)).claims);
    expect(none!.properties).toEqual([]);
  });

  it("ignores inactive properties, other organizations' roles and non-catalog keys", async () => {
    // A grant at a property that is then deactivated.
    const inactive = await createCustomUser(org, "sr-inactive", [
      { permissions: ["frontdesk:read"], property: "A" },
      { permissions: ["frontdesk:read"], property: "C" },
    ]);
    // A role of ANOTHER organization assigned to this user (never authorizes anything).
    const foreign = await createCustomUser(org, "sr-foreign", [
      { permissions: ["frontdesk:read"], property: "A" },
    ]);
    const foreignRole = await prisma.role.create({
      data: {
        organizationId: other.organizationId,
        code: `FOREIGN_${org.suffix}`.slice(0, 40),
        name: "Foreign",
        permissions: { create: [{ permissionKey: "billing:read" }] },
      },
      select: { id: true },
    });
    await prisma.userRoleAssignment.create({
      data: {
        userId: foreign.id,
        roleId: foreignRole.id,
        scope: "ORGANIZATION",
        propertyId: null,
        grantedById: org.adminId,
      },
    });
    // An organization-scope grant of a key that is no longer in the catalog: it must
    // not make the user organization-wide (only property A is reachable).
    const legacy = await createCustomUser(org, "sr-legacy", [
      { permissions: ["frontdesk:read"], property: "A" },
    ]);
    const legacyRole = await prisma.role.create({
      data: {
        organizationId: org.organizationId,
        code: `LEGACY_${org.suffix}`.slice(0, 40),
        name: "Legacy",
        permissions: { create: [{ permissionKey: LEGACY_KEY }] },
      },
      select: { id: true },
    });
    await prisma.userRoleAssignment.create({
      data: {
        userId: legacy.id,
        roleId: legacyRole.id,
        scope: "ORGANIZATION",
        propertyId: null,
        grantedById: org.adminId,
      },
    });
    // A system role (organization_id null) assigned at property B counts.
    const system = await createCustomUser(org, "sr-system", []);
    const systemRole = await prisma.role.create({
      data: {
        organizationId: null,
        code: `SYS_${org.suffix}`.slice(0, 40),
        name: "System test role",
        isSystem: true,
        permissions: { create: [{ permissionKey: "rooms:read" }] },
      },
      select: { id: true },
    });
    await prisma.userRoleAssignment.create({
      data: {
        userId: system.id,
        roleId: systemRole.id,
        scope: "PROPERTY",
        propertyId: org.properties.B!.id,
        grantedById: org.adminId,
      },
    });

    const orgWide = await createCustomUser(org, "sr-inactive-org", [
      { permissions: ["frontdesk:read"] },
    ]);
    const sessions = {
      orgWide: await sessionFor(orgWide.email),
      inactive: await sessionFor(inactive.email),
      foreign: await sessionFor(foreign.email),
      legacy: await sessionFor(legacy.email),
      system: await sessionFor(system.email),
    };
    await prisma.property.update({
      where: { id: org.properties.C!.id },
      data: { status: "INACTIVE" },
    });
    try {
      for (const { claims } of Object.values(sessions)) await expectSameAsBefore(claims);
      const ids = async (claims: AccessTokenClaims) =>
        (await resolveSession(claims))!.properties.map((p) => p.id);
      // Organization-wide access never includes the inactive property.
      expect(await ids(sessions.orgWide.claims)).toEqual(
        [org.properties.A!, org.properties.B!]
          .sort((x, y) => x.code.localeCompare(y.code))
          .map((p) => p.id),
      );
      expect(await ids(sessions.inactive.claims)).toEqual([org.properties.A!.id]);
      expect(await ids(sessions.foreign.claims)).toEqual([org.properties.A!.id]);
      expect(
        (await resolveSession(sessions.foreign.claims))!.access.organizationPermissions,
      ).toEqual([]);
      expect(await ids(sessions.legacy.claims)).toEqual([org.properties.A!.id]);
      expect(await ids(sessions.system.claims)).toEqual([org.properties.B!.id]);
    } finally {
      await prisma.property.update({
        where: { id: org.properties.C!.id },
        data: { status: "ACTIVE" },
      });
    }
  });

  it("authenticates a property request in one statement", async () => {
    const user = await createCustomUser(org, "sr-count", [
      { permissions: ["frontdesk:read"], property: "A" },
    ]);
    const { jar } = await sessionFor(user.email);
    await me(jar); // warm-up
    const { result, statements, texts } = await countStatements(() => me(jar));
    expect(result.status).toBe(200);
    expect(statements).toBe(1);
    expect(texts[0]).toMatch(/"auth_sessions"/);
  });
});

describe("security cases, each seen on the very next request", () => {
  it("rejects an expired access token", async () => {
    const user = await createCustomUser(org, "sr-expired", [{ permissions: ["guests:read"] }]);
    const { jar, claims } = await sessionFor(user.email);
    const expired = await new SignJWT({ org: claims.organizationId, sid: claims.sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(claims.userId)
      .setIssuer("serene-management")
      .setAudience("serene-management-web")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1_000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(new TextEncoder().encode(serverEnv().AUTH_ACCESS_TOKEN_SECRET));
    jar.set(ACCESS_COOKIE, expired);
    expect((await me(jar)).status).toBe(401);
  });

  it("rejects a deleted session and a token whose claims do not match the session", async () => {
    const a = await createCustomUser(org, "sr-del-a", [{ permissions: ["guests:read"] }]);
    const b = await createCustomUser(org, "sr-del-b", [{ permissions: ["guests:read"] }]);
    const sa = await sessionFor(a.email);
    const sb = await sessionFor(b.email);
    // B's session id presented under A's identity.
    expect(await resolveSession({ ...sa.claims, sessionId: sb.claims.sessionId })).toBeNull();
    // Right session, wrong organization claim.
    expect(await resolveSession({ ...sa.claims, organizationId: other.organizationId })).toBeNull();
    expect((await me(sa.jar)).status).toBe(200);
    await prisma.authSession.delete({ where: { id: sa.claims.sessionId } });
    expect((await me(sa.jar)).status).toBe(401);
  });

  it("rejects every session of an organization that becomes inactive", async () => {
    const lone = await createFixtureOrg({ properties: [{ key: "L", timezone: "Asia/Karachi" }] });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: lone.adminId },
      select: { email: true },
    });
    const { jar } = await sessionFor(admin.email);
    expect((await me(jar)).status).toBe(200);
    await prisma.organization.update({
      where: { id: lone.organizationId },
      data: { status: "INACTIVE" },
    });
    expect((await me(jar)).status).toBe(401);
  });

  it("applies a permission removed from a role, and a lost organization grant, immediately", async () => {
    const user = await createCustomUser(org, "sr-role", [
      { permissions: ["frontdesk:read", "audit:read"], property: "A" },
    ]);
    const { jar } = await sessionFor(user.email);
    const A = org.properties.A!.id;
    expect((await auditLogs(jar, A)).status).toBe(200);
    const assignment = await prisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: user.id },
      select: { roleId: true },
    });
    await prisma.rolePermission.delete({
      where: { roleId_permissionKey: { roleId: assignment.roleId, permissionKey: "audit:read" } },
    });
    expect((await auditLogs(jar, A)).status).toBe(403);
    expect((await businessDate(jar, A)).status).toBe(200);

    const orgWide = await createCustomUser(org, "sr-orgwide", [
      { permissions: ["frontdesk:read"] },
    ]);
    const session = await sessionFor(orgWide.email);
    const codes = async () =>
      (await me(session.jar)).body.data.properties.map((p: { code: string }) => p.code);
    expect(await codes()).toHaveLength(3);
    await prisma.userRoleAssignment.deleteMany({ where: { userId: orgWide.id } });
    expect(await codes()).toEqual([]);
    expect((await businessDate(session.jar, A)).status).toBe(403);
  });
});
