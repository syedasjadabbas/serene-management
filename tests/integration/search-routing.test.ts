import { beforeAll, describe, expect, it } from "vitest";
import { GET as accountRoute } from "@/app/api/v1/accounts/[accountId]/route";
import { POST as createAccountRoute } from "@/app/api/v1/accounts/route";
import { GET as guestRoute } from "@/app/api/v1/guests/[guestId]/route";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { profileTargetCode } from "@/components/workspace/searchTargets";
import type { Permission } from "@/lib/permissions/catalog";
import { prisma } from "@/lib/db/prisma";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  createCustomUser,
  createFixtureOrg,
  createGuestRow,
} from "./support/fixtures";
import { call, loginAs } from "./support/http";

/**
 * Global search routes organization-level records (guests, companies) to a
 * property resolved from the signed-in user's own session: it must always
 * be a property the user can access and read that record type in, and the
 * record must then really be readable there.
 */

let org: FixtureOrg;
let guestId: string;
let accountId: string;

interface Me {
  user: { isSuperAdmin: boolean };
  properties: { id: string; code: string; permissions: string[] }[];
}

async function session(
  localPart: string,
  grants: { permissions: Permission[]; property?: string }[],
) {
  const user = await createCustomUser(org, localPart, grants);
  const jar = await loginAs(user.email, TEST_PASSWORD);
  const me = await call(meRoute, { path: "/api/v1/me", jar });
  expect(me.status).toBe(200);
  return { jar, me: me.body.data as Me };
}

function expectPermitted(me: Me, code: string | null, permission: Permission) {
  expect(code).not.toBeNull();
  const property = me.properties.find((p) => p.code === code);
  expect(property, `resolved ${code} must be an accessible property`).toBeDefined();
  expect(property!.permissions).toContain(permission);
}

const code = (key: string) => org.properties[key]!.code;

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
      { key: "C", timezone: "Asia/Karachi" },
    ],
  });
  guestId = (await createGuestRow(org, "Routing", "Probe")).id;
  const admin = await prisma.user.findUniqueOrThrow({
    where: { id: org.adminId },
    select: { email: true },
  });
  const adminJar = await loginAs(admin.email, TEST_PASSWORD);
  const created = await call(createAccountRoute, {
    method: "POST",
    path: "/api/v1/accounts",
    body: { code: `RT${org.suffix.slice(0, 6)}`, name: "Routing Probe Ltd" },
    jar: adminJar,
  });
  expect(created.status).toBe(201);
  accountId = created.body.data.id;
}, 120_000);

describe("global search routing of guests and companies", () => {
  it("multiple properties: guests open in the lowest permitted property, companies only where accounts:read is held", async () => {
    const { jar, me } = await session("route-multi", [
      { permissions: ["guests:read"], property: "A" },
      { permissions: ["guests:read", "accounts:read"], property: "B" },
    ]);
    const guests = profileTargetCode(me, "guests:read");
    const companies = profileTargetCode(me, "accounts:read");
    expectPermitted(me, guests, "guests:read");
    expectPermitted(me, companies, "accounts:read");
    expect(guests).toBe([code("A"), code("B")].sort()[0]);
    expect(companies).toBe(code("B"));
    expect(me.properties.map((p) => p.code)).not.toContain(code("C"));
    // The records really are readable for this user.
    expect(
      (await call(guestRoute, { path: `/api/v1/guests/${guestId}`, params: { guestId }, jar }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(accountRoute, {
          path: `/api/v1/accounts/${accountId}`,
          params: { accountId },
          jar,
        })
      ).status,
    ).toBe(200);
  });

  it("single property: both record types open in that property", async () => {
    const { me } = await session("route-single", [
      { permissions: ["guests:read", "accounts:read"], property: "C" },
    ]);
    expect(me.properties.map((p) => p.code)).toEqual([code("C")]);
    expect(profileTargetCode(me, "guests:read")).toBe(code("C"));
    expect(profileTargetCode(me, "accounts:read")).toBe(code("C"));
  });

  it("different properties per record type: companies never go to the guest-only property", async () => {
    const { me } = await session("route-split", [
      { permissions: ["accounts:read"], property: "A" },
      { permissions: ["guests:read"], property: "B" },
    ]);
    expect(profileTargetCode(me, "guests:read")).toBe(code("B"));
    expect(profileTargetCode(me, "accounts:read")).toBe(code("A"));
    expectPermitted(me, profileTargetCode(me, "guests:read"), "guests:read");
    expectPermitted(me, profileTargetCode(me, "accounts:read"), "accounts:read");
  });

  it("no permitted property for a record type: nothing to link to", async () => {
    const { me } = await session("route-none", [{ permissions: ["accounts:read"], property: "A" }]);
    expect(profileTargetCode(me, "guests:read")).toBeNull();
    expect(profileTargetCode(me, "accounts:read")).toBe(code("A"));
  });

  it("organization-level grant: every property is permitted and the choice stays within them", async () => {
    const { me } = await session("route-org", [{ permissions: ["guests:read"] }]);
    const target = profileTargetCode(me, "guests:read");
    expectPermitted(me, target, "guests:read");
    expect(target).toBe(me.properties.map((p) => p.code).sort()[0]);
  });
});
