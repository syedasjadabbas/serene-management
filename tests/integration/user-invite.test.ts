import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as resetCompleteRoute } from "@/app/api/v1/auth/password/reset/route";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { POST as resetIssueRoute } from "@/app/api/v1/users/[userId]/password-reset/route";
import { GET as usersRoute, POST as inviteRoute } from "@/app/api/v1/users/route";
import { prisma } from "@/lib/db/prisma";
import { type FixtureOrg, TEST_PASSWORD, createFixtureOrg, createUser } from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

/**
 * Adding users (users:manage "invite", docs/RBAC.md): an INVITED account with
 * a first role and a one-time set-password link handed over by the
 * administrator; the account becomes ACTIVE when the person sets a password.
 */

let org: FixtureOrg;
let adminJar: CookieJar;
let gmJar: CookieJar;
let agentJar: CookieJar;
const NEW_PASSWORD = "Invited-user-password-42";

const invite = (jar: CookieJar, body: Record<string, unknown>) =>
  call(inviteRoute, { method: "POST", path: "/api/v1/users", body, jar });
const tokenOf = (url: string) => new URL(url).hash.replace(/^#token=/, "");
const email = (local: string) => `${local}.${org.suffix.toLowerCase()}@serene.test`;

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  adminJar = await loginAs(email("admin"), TEST_PASSWORD);
  const gm = await createUser(org, "gm", [{ role: "GENERAL_MANAGER", property: "A" }]);
  gmJar = await loginAs(gm.email, TEST_PASSWORD);
  const agent = await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
  agentJar = await loginAs(agent.email, TEST_PASSWORD);
});

describe("inviting a user", () => {
  it("creates an invited user with a first role and a one-time link; setting a password activates it", async () => {
    const address = email("newdesk");
    const r = await invite(adminJar, {
      email: address.toUpperCase(),
      displayName: "New Desk Clerk",
      role: {
        scope: "PROPERTY",
        roleId: org.roleIds.FRONT_DESK_AGENT,
        propertyId: org.properties.A!.id,
      },
      reason: "New hire",
    });
    expect(r.status).toBe(201);
    const data = r.body.data as {
      user: {
        id: string;
        email: string;
        status: string;
        assignments: { role: { code: string } }[];
      };
      setupUrl: string;
      expiresAt: string;
    };
    expect(data.user.email).toBe(address);
    expect(data.user.status).toBe("INVITED");
    expect(data.user.assignments.map((a) => a.role.code)).toEqual(["FRONT_DESK_AGENT"]);
    expect(data.setupUrl).toMatch(/\/reset-password#token=/);
    const hours = (new Date(data.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: data.user.id } });
    expect(row.passwordHash).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.invite", resourceId: data.user.id },
    });
    expect(audit.risk).toBe("HIGH");
    expect(JSON.stringify(audit.after)).not.toContain(tokenOf(data.setupUrl));

    // No password yet: sign-in is refused with the generic message.
    const before = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: address, password: NEW_PASSWORD },
    });
    expect(before.status).toBe(401);

    const done = await call(resetCompleteRoute, {
      method: "POST",
      path: "/api/v1/auth/password/reset",
      body: { token: tokenOf(data.setupUrl), newPassword: NEW_PASSWORD },
    });
    expect(done.status).toBeLessThan(300);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: data.user.id } })).status).toBe(
      "ACTIVE",
    );

    const jar = await loginAs(address, NEW_PASSWORD);
    const me = await call(meRoute, { path: "/api/v1/me", jar });
    const property = (
      me.body.data as { properties: { id: string; permissions: string[] }[] }
    ).properties.find((p) => p.id === org.properties.A!.id);
    expect(property?.permissions).toContain("frontdesk:checkin");

    // The link works once.
    const again = await call(resetCompleteRoute, {
      method: "POST",
      path: "/api/v1/auth/password/reset",
      body: { token: tokenOf(data.setupUrl), newPassword: "Another-password-4242" },
    });
    expect(again.status).toBe(400);
  });

  it("refuses a second account with the same e-mail address", async () => {
    const body = {
      email: email("twice"),
      displayName: "Twice",
      role: {
        scope: "PROPERTY",
        roleId: org.roleIds.FRONT_DESK_AGENT,
        propertyId: org.properties.A!.id,
      },
      reason: "New hire",
    };
    expect((await invite(adminJar, body)).status).toBe(201);
    const second = await invite(adminJar, body);
    expect(second.status).toBe(409);
    expect((second.body.error as { details?: { reason?: string } }).details?.reason).toBe(
      "EMAIL_TAKEN",
    );
  });

  it("lets a property manager invite only into their property, without escalation", async () => {
    const atA = (role: string) => ({
      email: email(`gm-${role.toLowerCase()}`),
      displayName: `Invited by GM ${role}`,
      role: { scope: "PROPERTY", roleId: org.roleIds[role], propertyId: org.properties.A!.id },
      reason: "New hire",
    });
    expect((await invite(gmJar, atA("FRONT_DESK_AGENT"))).status).toBe(201);
    // The administrator role holds permissions the GM does not (properties:manage, roles:manage).
    expect((await invite(gmJar, atA("ORGANIZATION_ADMIN"))).status).toBe(403);
    // Organization-wide grants need users:manage at organization scope.
    const orgWide = await invite(gmJar, {
      email: email("gm-orgwide"),
      displayName: "Org wide",
      role: { scope: "ORGANIZATION", roleId: org.roleIds.READ_ONLY },
      reason: "New hire",
    });
    expect(orgWide.status).toBe(403);
    expect(await prisma.user.count({ where: { email: email("gm-organization_admin") } })).toBe(0);
  });

  it("refuses users without users:manage", async () => {
    const r = await invite(agentJar, {
      email: email("by-agent"),
      displayName: "By agent",
      role: { scope: "PROPERTY", roleId: org.roleIds.READ_ONLY, propertyId: org.properties.A!.id },
      reason: "New hire",
    });
    expect(r.status).toBe(403);
  });

  it("issues a new 24-hour invitation link to a user who is still invited", async () => {
    const created = await invite(adminJar, {
      email: email("lostlink"),
      displayName: "Lost Link",
      role: {
        scope: "PROPERTY",
        roleId: org.roleIds.FRONT_DESK_AGENT,
        propertyId: org.properties.A!.id,
      },
      reason: "New hire",
    });
    const first = created.body.data as { user: { id: string }; setupUrl: string };
    const reissued = await call(resetIssueRoute, {
      method: "POST",
      path: `/api/v1/users/${first.user.id}/password-reset`,
      params: { userId: first.user.id },
      body: { reason: "Lost the first link" },
      jar: adminJar,
    });
    expect(reissued.status).toBe(201);
    const next = reissued.body.data as { resetUrl: string; expiresAt: string };
    expect((new Date(next.expiresAt).getTime() - Date.now()) / 3_600_000).toBeGreaterThan(23);
    // The first link stopped working.
    const old = await call(resetCompleteRoute, {
      method: "POST",
      path: "/api/v1/auth/password/reset",
      body: { token: tokenOf(first.setupUrl), newPassword: NEW_PASSWORD },
    });
    expect(old.status).toBe(400);
  });
});

describe("searching users (QA report: Organization > Users & roles)", () => {
  it("matches every word of the query in any order, ignoring case and extra spaces", async () => {
    const address = email("bilal.ahmed");
    const created = await invite(adminJar, {
      email: address,
      displayName: "Bilal Ahmed (Front Office Manager)",
      role: {
        scope: "PROPERTY",
        roleId: org.roleIds.FRONT_DESK_AGENT,
        propertyId: org.properties.A!.id,
      },
      reason: "Search regression",
    });
    expect(created.status).toBe(201);
    const search = async (q: string) => {
      const r = await call(usersRoute, {
        path: `/api/v1/users?page=1&pageSize=50&q=${encodeURIComponent(q)}`,
        jar: adminJar,
      });
      expect(r.status).toBe(200);
      return (r.body.data as { email: string }[]).some((u) => u.email === address);
    };
    for (const q of [
      "Bilal Ahmed",
      "bilal",
      "ahmed",
      "BILAL AHMED",
      "  Bilal Ahmed  ",
      "Ahmed Bilal",
      "bilal   ahmed",
      "Office Bilal",
      "Bil",
      address,
      "bilal.ahmed",
      // QA report: "Bilal Ahmad" must find "Bilal Ahmed" (same name, other spelling).
      "Bilal Ahmad",
      "ahmad",
      "Ahmad Bilal",
    ]) {
      expect(await search(q), q).toBe(true);
    }
    // Spelling tolerance compares consonants, never invents a name.
    expect(await search("Bilal Ahmadzai")).toBe(false);
    expect(await search("Bilal Khan")).toBe(false);
    expect(await search("zzqx")).toBe(false);
  });

  it("never returns users of another organization, and counts every match", async () => {
    const other = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
    const outsider = await prisma.user.create({
      data: {
        organizationId: other.organizationId,
        email: `bilal.outsider.${other.suffix.toLowerCase()}@serene.test`,
        displayName: "Bilal Ahmed (other organization)",
        status: "ACTIVE",
      },
      select: { email: true },
    });
    const r = await call(usersRoute, {
      path: `/api/v1/users?page=1&pageSize=1&q=${encodeURIComponent("bilal ahmad")}`,
      jar: adminJar,
    });
    expect(r.status).toBe(200);
    const rows = r.body.data as { email: string }[];
    expect(rows.some((u) => u.email === outsider.email)).toBe(false);
    // Page size 1 still reports the total, so paging cannot hide a match.
    expect((r.body.meta as { total: number }).total).toBeGreaterThanOrEqual(1);
    expect(rows).toHaveLength(1);
  });
});
