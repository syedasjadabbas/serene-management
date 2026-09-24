import { beforeAll, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { POST as createPropertyRoute } from "@/app/api/v1/properties/route";
import { GET as auditLogsRoute } from "@/app/api/v1/properties/[propertyId]/audit-logs/route";
import { GET as businessDateRoute } from "@/app/api/v1/properties/[propertyId]/business-date/route";
import {
  GET as getConfigurationRoute,
  PATCH as patchConfigurationRoute,
} from "@/app/api/v1/properties/[propertyId]/configuration/route";
import { GET as propertyRoute } from "@/app/api/v1/properties/[propertyId]/route";
import { POST as grantRoute } from "@/app/api/v1/users/[userId]/role-assignments/route";
import { DELETE as revokeRoute } from "@/app/api/v1/users/[userId]/role-assignments/[assignmentId]/route";
import { GET as usersRoute } from "@/app/api/v1/users/route";
import { prisma } from "@/lib/db/prisma";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  auditLogsFor,
  createFixtureOrg,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

let org: FixtureOrg;
let otherOrg: FixtureOrg;
let A: string;
let B: string;
let gmA: { id: string; email: string };
let hkA: { id: string; email: string };
let target: { id: string; email: string };
let gmAJar: CookieJar;
let hkAJar: CookieJar;

const configurationPath = (propertyId: string) => `/api/v1/properties/${propertyId}/configuration`;

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
    ],
  });
  otherOrg = await createFixtureOrg({ properties: [{ key: "X", timezone: "Europe/London" }] });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  gmA = await createUser(org, "gm-a", [{ role: "GENERAL_MANAGER", property: "A" }]);
  hkA = await createUser(org, "hk-a", [{ role: "HOUSEKEEPER", property: "A" }]);
  target = await createUser(org, "target", []);
  gmAJar = await loginAs(gmA.email, TEST_PASSWORD);
  hkAJar = await loginAs(hkA.email, TEST_PASSWORD);
});

describe("RBAC: permission checks", () => {
  it("allows an action the role grants", async () => {
    const r = await call(getConfigurationRoute, {
      path: configurationPath(A),
      params: { propertyId: A },
      jar: gmAJar,
    });
    expect(r.status).toBe(200);
    expect(r.body.data.propertyId).toBe(A);
  });

  it("denies an action the role does not grant and names the permission", async () => {
    const r = await call(getConfigurationRoute, {
      path: configurationPath(A),
      params: { propertyId: A },
      jar: hkAJar,
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "settings:read" },
    });
  });

  it("does not let a property-level grant authorize an organization-level action", async () => {
    const r = await call(createPropertyRoute, {
      method: "POST",
      path: "/api/v1/properties",
      body: {
        code: "NEWONE",
        name: "Should not exist",
        timezone: "Asia/Karachi",
        currencyCode: "PKR",
        countryCode: "PK",
        reason: "Trying to escalate",
      },
      jar: gmAJar,
    });
    expect(r.status).toBe(403);
    expect(r.body.error.details.permission).toBe("properties:manage");
  });

  it("organization-level grants cover every property", async () => {
    const adminJar = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
    for (const propertyId of [A, B]) {
      const r = await call(getConfigurationRoute, {
        path: configurationPath(propertyId),
        params: { propertyId },
        jar: adminJar,
      });
      expect(r.status).toBe(200);
    }
  });
});

describe("RBAC: high-risk permissions", () => {
  it("requires a written reason", async () => {
    const r = await call(patchConfigurationRoute, {
      method: "PATCH",
      path: configurationPath(A),
      params: { propertyId: A },
      body: { allowOverbooking: true },
      jar: gmAJar,
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
    expect(r.body.error.details.fields.reason).toBeDefined();
  });

  it("applies the change and writes a HIGH audit record with before/after and reason", async () => {
    const r = await call(patchConfigurationRoute, {
      method: "PATCH",
      path: configurationPath(A),
      params: { propertyId: A },
      body: { allowOverbooking: true, roomHoldDefaultMinutes: 45, reason: "Peak season policy" },
      jar: gmAJar,
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ allowOverbooking: true, roomHoldDefaultMinutes: 45 });

    const audit = (await auditLogsFor(A)).find((a) => a.action === "property.configuration_update");
    expect(audit).toMatchObject({
      organizationId: org.organizationId,
      propertyId: A,
      userId: gmA.id,
      resourceType: "PropertyConfiguration",
      risk: "HIGH",
      reason: "Peak season policy",
      userAgent: "vitest-integration",
    });
    expect(audit?.requestId).toEqual(expect.any(String));
    expect(audit?.ipAddress).toEqual(expect.any(String));
    expect(audit?.before).toEqual({ allowOverbooking: false, roomHoldDefaultMinutes: 30 });
    expect(audit?.after).toEqual({
      allowOverbooking: true,
      roomHoldDefaultMinutes: 45,
      meta: { permission: "settings:manage" },
    });
  });
});

describe("RBAC: role administration", () => {
  it("lets a property GM grant a role at their own property (audited HIGH)", async () => {
    const r = await call(grantRoute, {
      method: "POST",
      path: `/api/v1/users/${target.id}/role-assignments`,
      params: { userId: target.id },
      body: {
        scope: "PROPERTY",
        propertyId: A,
        roleId: org.roleIds.FRONT_DESK_AGENT,
        reason: "New hire",
      },
      jar: gmAJar,
    });
    expect(r.status).toBe(201);
    const assignment = r.body.data.assignments.find(
      (a: { property: { id: string } | null }) => a.property?.id === A,
    );
    expect(assignment.role.code).toBe("FRONT_DESK_AGENT");
    const audit = await auditLogsFor(assignment.id);
    expect(audit[0]).toMatchObject({
      action: "user.role_grant",
      risk: "HIGH",
      reason: "New hire",
      propertyId: A,
    });

    // The new grant is effective on the target's next request.
    const targetJar = await loginAs(target.email, TEST_PASSWORD);
    const me = await call(meRoute, { path: "/api/v1/me", jar: targetJar });
    expect(me.body.data.properties.map((p: { id: string }) => p.id)).toEqual([A]);

    const revoke = await call(revokeRoute, {
      method: "DELETE",
      path: `/api/v1/users/${target.id}/role-assignments/${assignment.id}`,
      params: { userId: target.id, assignmentId: assignment.id },
      body: { reason: "Contract ended" },
      jar: gmAJar,
    });
    expect(revoke.status).toBe(200);
    expect(
      (await call(meRoute, { path: "/api/v1/me", jar: targetJar })).body.data.properties,
    ).toEqual([]);
  });

  it("rejects granting at a property where the grantor has no access (property id from the body)", async () => {
    const r = await call(grantRoute, {
      method: "POST",
      path: `/api/v1/users/${target.id}/role-assignments`,
      params: { userId: target.id },
      body: {
        scope: "PROPERTY",
        propertyId: B,
        roleId: org.roleIds.FRONT_DESK_AGENT,
        reason: "Attempt",
      },
      jar: gmAJar,
    });
    expect(r.status).toBe(403);
  });

  it("rejects privilege escalation beyond the grantor's own permissions", async () => {
    const r = await call(grantRoute, {
      method: "POST",
      path: `/api/v1/users/${target.id}/role-assignments`,
      params: { userId: target.id },
      body: {
        scope: "PROPERTY",
        propertyId: A,
        roleId: org.roleIds.ORGANIZATION_ADMIN,
        reason: "Attempt",
      },
      jar: gmAJar,
    });
    expect(r.status).toBe(403);
    expect(r.body.error.details.missingPermissions).toContain("properties:manage");
  });

  it("rejects organization-scope grants from a property-level administrator", async () => {
    const r = await call(grantRoute, {
      method: "POST",
      path: `/api/v1/users/${target.id}/role-assignments`,
      params: { userId: target.id },
      body: { scope: "ORGANIZATION", roleId: org.roleIds.READ_ONLY, reason: "Attempt" },
      jar: gmAJar,
    });
    expect(r.status).toBe(403);
  });

  it("rejects changing one's own grants", async () => {
    const r = await call(grantRoute, {
      method: "POST",
      path: `/api/v1/users/${gmA.id}/role-assignments`,
      params: { userId: gmA.id },
      body: { scope: "PROPERTY", propertyId: A, roleId: org.roleIds.READ_ONLY, reason: "Self" },
      jar: gmAJar,
    });
    expect(r.status).toBe(403);
  });

  it("hides users of other organizations", async () => {
    const outsider = await createUser(otherOrg, "outsider", []);
    const r = await call(grantRoute, {
      method: "POST",
      path: `/api/v1/users/${outsider.id}/role-assignments`,
      params: { userId: outsider.id },
      body: {
        scope: "PROPERTY",
        propertyId: A,
        roleId: org.roleIds.READ_ONLY,
        reason: "Cross-tenant",
      },
      jar: gmAJar,
    });
    expect(r.status).toBe(404);

    const list = await call(usersRoute, { path: "/api/v1/users?pageSize=200", jar: gmAJar });
    expect(list.status).toBe(200);
    expect(list.body.data.some((u: { id: string }) => u.id === outsider.id)).toBe(false);
    expect(list.body.meta).toMatchObject({ page: 1, pageSize: 200 });
  });

  it("denies user listing without users:read", async () => {
    expect((await call(usersRoute, { path: "/api/v1/users", jar: hkAJar })).status).toBe(403);
  });
});

describe("Property isolation: User A + Property A cannot reach Property B", () => {
  const endpoints = [
    { name: "property", route: propertyRoute, path: (id: string) => `/api/v1/properties/${id}` },
    {
      name: "business date",
      route: businessDateRoute,
      path: (id: string) => `/api/v1/properties/${id}/business-date`,
    },
    { name: "configuration", route: getConfigurationRoute, path: configurationPath },
    {
      name: "audit log",
      route: auditLogsRoute,
      path: (id: string) => `/api/v1/properties/${id}/audit-logs`,
    },
  ];

  it.each(endpoints)("can read $name of property A", async ({ route, path }) => {
    const r = await call(route, { path: path(A), params: { propertyId: A }, jar: gmAJar });
    expect(r.status).toBe(200);
  });

  it.each(endpoints)(
    "is refused $name of property B when B's id is supplied manually",
    async ({ route, path }) => {
      const r = await call(route, { path: path(B), params: { propertyId: B }, jar: gmAJar });
      expect(r.status).toBe(403);
      expect(r.body.error.message).toBe("You do not have access to this property");
      expect(JSON.stringify(r.body)).not.toContain(org.properties.B!.code);
    },
  );

  it("refuses another organization's property and a non-existent id identically", async () => {
    const foreign = otherOrg.properties.X!.id;
    const missing = "01900000-0000-7000-8000-000000000000";
    const results = await Promise.all(
      [foreign, missing, "not-a-uuid"].map((propertyId) =>
        call(businessDateRoute, {
          path: `/api/v1/properties/${propertyId}/business-date`,
          params: { propertyId },
          jar: gmAJar,
        }),
      ),
    );
    for (const r of results) {
      expect(r.status).toBe(403);
      expect(r.body.error.message).toBe("You do not have access to this property");
    }
  });

  it("refuses writes to property B even with a valid reason", async () => {
    const r = await call(patchConfigurationRoute, {
      method: "PATCH",
      path: configurationPath(B),
      params: { propertyId: B },
      body: { allowOverbooking: true, reason: "Cross-property attempt" },
      jar: gmAJar,
    });
    expect(r.status).toBe(403);
    const configB = await prisma.propertyConfiguration.findUnique({ where: { propertyId: B } });
    expect(configB?.allowOverbooking).toBe(false);
  });

  it("lists only accessible properties in /me", async () => {
    const r = await call(meRoute, { path: "/api/v1/me", jar: gmAJar });
    expect(r.body.data.properties.map((p: { id: string }) => p.id)).toEqual([A]);
  });

  it("stops access as soon as the property grant is removed", async () => {
    const temp = await createUser(org, "temp-b", [{ role: "READ_ONLY", property: "B" }]);
    const jar = await loginAs(temp.email, TEST_PASSWORD);
    const path = `/api/v1/properties/${B}/business-date`;
    expect((await call(businessDateRoute, { path, params: { propertyId: B }, jar })).status).toBe(
      200,
    );
    await prisma.userRoleAssignment.deleteMany({ where: { userId: temp.id } });
    expect((await call(businessDateRoute, { path, params: { propertyId: B }, jar })).status).toBe(
      403,
    );
  });
});
