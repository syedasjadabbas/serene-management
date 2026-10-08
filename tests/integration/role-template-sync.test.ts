import { beforeAll, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { prisma } from "@/lib/db/prisma";
import { ROLE_TEMPLATES } from "@/lib/permissions/roles";
import { syncOrganizationRoleCopies } from "@/prisma/seed/reference";
import { type FixtureOrg, TEST_PASSWORD, createFixtureOrg, createUser } from "./support/fixtures";
import { call, loginAs } from "./support/http";

/**
 * QA report: users hold their organization's copy of a role template, and a
 * permission added to the template later (`loyalty:read`, Phase 7) never
 * reached those copies, so front office roles had no Loyalty. The reference
 * seed now adds such permissions to the copies, and never removes any.
 *
 * The test drives the seed's sync step for this file's organization only:
 * the full reference seed rewrites the shared system templates, which other
 * test files read while they create their own organizations in parallel.
 */
const sync = () => syncOrganizationRoleCopies(prisma, org.organizationId);
let org: FixtureOrg;

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
});

async function permissionsOf(roleId: string) {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionKey: true },
  });
  return rows.map((r) => r.permissionKey).sort();
}

describe("organization role copies follow their templates", () => {
  it("adds a permission the template gained after the copy was made, and it reaches /me", async () => {
    const roleId = org.roleIds.FRONT_OFFICE_MANAGER!;
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionKey: "loyalty:read" } });
    const user = await createUser(org, "sync-fom", [
      { role: "FRONT_OFFICE_MANAGER", property: "A" },
    ]);
    const jar = await loginAs(user.email, TEST_PASSWORD);
    const before = await call(meRoute, { path: "/api/v1/me", jar });
    expect(before.body.data.properties[0].permissions).not.toContain("loyalty:read");

    expect(await sync()).toBeGreaterThanOrEqual(1);
    expect(await permissionsOf(roleId)).toEqual(
      [...ROLE_TEMPLATES.FRONT_OFFICE_MANAGER.permissions].sort(),
    );
    const after = await call(meRoute, {
      path: "/api/v1/me",
      jar: await loginAs(user.email, TEST_PASSWORD),
    });
    expect(after.body.data.properties[0].permissions).toContain("loyalty:read");
  });

  it("never removes what an organization's copy holds beyond the template", async () => {
    const roleId = org.roleIds.HOUSEKEEPER!;
    await prisma.rolePermission.create({ data: { roleId, permissionKey: "reports:read" } });
    await sync();
    expect(await permissionsOf(roleId)).toContain("reports:read");
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionKey: "reports:read" } });
  });

  it("is idempotent", async () => {
    await sync();
    const again = await sync();
    const copies = await prisma.role.findMany({
      where: { organizationId: org.organizationId },
      select: { id: true, code: true },
    });
    for (const copy of copies) {
      const template = ROLE_TEMPLATES[copy.code as keyof typeof ROLE_TEMPLATES];
      if (!template) continue;
      expect(await permissionsOf(copy.id), copy.code).toEqual(
        expect.arrayContaining([...template.permissions]),
      );
    }
    expect(again).toBe(0);
  });
});
