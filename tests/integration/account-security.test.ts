import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as resetCompleteRoute } from "@/app/api/v1/auth/password/reset/route";
import { POST as changePasswordRoute } from "@/app/api/v1/auth/password/route";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { POST as disableRoute } from "@/app/api/v1/users/[userId]/disable/route";
import { POST as enableRoute } from "@/app/api/v1/users/[userId]/enable/route";
import { POST as resetIssueRoute } from "@/app/api/v1/users/[userId]/password-reset/route";
import { DELETE as revokeRoute } from "@/app/api/v1/users/[userId]/role-assignments/[assignmentId]/route";
import { POST as unlockRoute } from "@/app/api/v1/users/[userId]/unlock/route";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/cookies";
import { hashOpaqueToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db/prisma";
import { LOCKOUT_THRESHOLD, login } from "@/modules/identity/identity.service";
import { type FixtureOrg, TEST_PASSWORD, createFixtureOrg, createUser } from "./support/fixtures";
import { CookieJar, call, loginAs } from "./support/http";

/**
 * Phase 10 batch 1: trusted client IP (H2), per-account login protection
 * (H5), administration authority and last-administrator guard (H3), password
 * change and administrator reset (H4). Integration requests run as if behind
 * one trusted proxy (TRUSTED_PROXY_HOPS=1): the LAST X-Forwarded-For entry is
 * the client address.
 */

const GENERIC = "Invalid email or password.";
const NEW_PASSWORD = "A-new-strong-password-42";

let org: FixtureOrg;
let adminJar: CookieJar;
let adminId: string;

const reason = { reason: "Security test" };

async function attempt(email: string, password: string, ip?: string) {
  return call(loginRoute, {
    method: "POST",
    path: "/api/v1/auth/login",
    body: { email, password },
    ...(ip === undefined ? {} : { ip }),
  });
}

function me(jar: CookieJar) {
  return call(meRoute, { path: "/api/v1/me", jar });
}

function refreshWith(jar: CookieJar) {
  return call(refreshRoute, { method: "POST", path: "/api/v1/auth/refresh", jar });
}

function copyJar(from: CookieJar) {
  const jar = new CookieJar();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    const value = from.get(name);
    if (value) jar.set(name, value);
  }
  return jar;
}

function userAction(
  route: typeof disableRoute,
  action: string,
  userId: string,
  jar: CookieJar,
  body: Record<string, unknown> = reason,
) {
  return call(route, {
    method: "POST",
    path: `/api/v1/users/${userId}/${action}`,
    params: { userId },
    body,
    jar,
  });
}

function email(local: string) {
  return `${local}.${org.suffix.toLowerCase()}@serene.test`;
}

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  adminId = org.adminId;
  adminJar = await loginAs(email("admin"), TEST_PASSWORD);
});

// --- H2 -----------------------------------------------------------------------------------

describe("H2 trusted client IP", () => {
  it("keys the anonymous login limit on the trusted hop, not on spoofed entries", async () => {
    const realIp = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      // A different spoofed prefix every time; the proxy-appended address is constant.
      const r = await attempt(
        `ghost${i}.${randomUUID().slice(0, 6)}@serene.test`,
        "x",
        `10.9.${i}.1, ${realIp}`,
      );
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("records the trusted address on the session and audit row", async () => {
    const user = await createUser(org, "iprecord", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const r = await attempt(user.email, TEST_PASSWORD, "6.6.6.6, 198.51.100.200");
    expect(r.status).toBe(200);
    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.ipAddress).toBe("198.51.100.200");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { userId: user.id, action: "auth.login" },
    });
    expect(audit.ipAddress).toBe("198.51.100.200");
  });

  it("does not share one bucket when no forwarded address is present", async () => {
    // Without a trusted address there is no IP key at all (the per-account
    // limit still applies): 25 distinct unknown emails are never IP-limited.
    for (let i = 0; i < 25; i++) {
      const r = await attempt(`nohdr${i}.${randomUUID().slice(0, 6)}@serene.test`, "x", "");
      expect(r.status).toBe(401);
    }
    const user = await createUser(org, "noipsession", [
      { role: "FRONT_DESK_AGENT", property: "A" },
    ]);
    expect((await attempt(user.email, TEST_PASSWORD, "")).status).toBe(200);
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.ipAddress).toBeNull();
  });
});

// --- H5 -----------------------------------------------------------------------------------

describe("H5 per-account login protection", () => {
  it("limits attempts per account across IPs, for unknown emails exactly like known ones", async () => {
    const unknown = `nobody.${randomUUID().slice(0, 8)}@serene.test`;
    const known = await createUser(org, "budget", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    for (const address of [unknown, known.email]) {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        // Every attempt from a different address: the budget follows the account.
        statuses.push((await attempt(address, "wrong-password", `198.18.${i}.${i + 1}`)).status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    }
    // Case and whitespace variants are the same account.
    expect((await attempt(`  ${known.email.toUpperCase()} `, "wrong-password")).status).toBe(429);
  });

  it("gives different accounts their own budget from the same IP", async () => {
    const ip = "198.19.1.1";
    const a = await createUser(org, "sameipa", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const b = await createUser(org, "sameipb", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    for (let i = 0; i < 3; i++) expect((await attempt(a.email, "wrong", ip)).status).toBe(401);
    expect((await attempt(b.email, TEST_PASSWORD, ip)).status).toBe(200);
  });

  it("admits at most the threshold of concurrent guesses before locking", async () => {
    const victim = await createUser(org, "burst", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) => attempt(victim.email, `guess-${i}`, `198.20.0.${i + 1}`)),
    );
    expect(results.every((r) => r.status === 401)).toBe(true);
    expect(results.every((r) => r.body.error.message === GENERIC)).toBe(true);
    const audits = await prisma.auditLog.findMany({
      where: {
        resourceId: victim.id,
        action: { in: ["auth.login_failed", "auth.login_rejected"] },
      },
    });
    // Exactly LOCKOUT_THRESHOLD guesses were evaluated; the rest met the lock.
    expect(audits.filter((a) => a.action === "auth.login_failed")).toHaveLength(LOCKOUT_THRESHOLD);
    expect(audits.filter((a) => a.action === "auth.login_rejected")).toHaveLength(
      9 - LOCKOUT_THRESHOLD,
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(row.failedLoginCount).toBe(LOCKOUT_THRESHOLD);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // Even the right password is refused while locked, with the same answer.
    const right = await attempt(victim.email, TEST_PASSWORD, "198.20.1.1");
    expect(right.status).toBe(401);
    expect(right.body.error.message).toBe(GENERIC);
  });

  it("lets the user in after the lock expires and resets the failure count", async () => {
    const user = await createUser(org, "expiry", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const meta = { requestId: "t-expiry", ipAddress: null, userAgent: null };
    const now = new Date();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await expect(login(meta, { email: user.email, password: "wrong" }, now)).rejects.toThrow();
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(login(meta, { email: user.email, password: TEST_PASSWORD }, now)).rejects.toThrow(
      GENERIC,
    );
    const later = new Date(locked.lockedUntil!.getTime() + 1_000);
    const ok = await login(meta, { email: user.email, password: TEST_PASSWORD }, later);
    expect(ok.result.user.id).toBe(user.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("resets failures on success and forgets a lock that ended long ago", async () => {
    const user = await createUser(org, "reset", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    for (let i = 0; i < 3; i++) await attempt(user.email, "wrong");
    expect((await attempt(user.email, TEST_PASSWORD)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(
      0,
    );
    // A lock two days old: the next failure starts a fresh count instead of 11.
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 10, lockedUntil: new Date(Date.now() - 2 * 86_400_000) },
    });
    expect((await attempt(user.email, "wrong")).status).toBe(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginCount).toBe(1);
    expect(row.lockedUntil).toBeNull();
  });

  it("answers disabled, locked, unknown and wrong-password attempts identically", async () => {
    const disabled = await createUser(org, "disabledlogin", [
      { role: "FRONT_DESK_AGENT", property: "A" },
    ]);
    await prisma.user.update({ where: { id: disabled.id }, data: { status: "DISABLED" } });
    const cases = [
      await attempt(disabled.email, TEST_PASSWORD),
      await attempt(`unknown.${randomUUID().slice(0, 6)}@serene.test`, TEST_PASSWORD),
      await attempt(email("admin"), "definitely-wrong"),
    ];
    for (const r of cases) {
      expect(r.status).toBe(401);
      expect(r.body.error).toMatchObject({ code: "UNAUTHENTICATED", message: GENERIC });
    }
    // A disabled account's failure count is not touched by attempts.
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: disabled.id } })).failedLoginCount,
    ).toBe(0);
    const rejected = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: disabled.id, action: "auth.login_rejected" },
    });
    expect(rejected.after).toMatchObject({ reason: "status_disabled" });
  });
});

// --- H3 -----------------------------------------------------------------------------------

describe("H3 administration authority", () => {
  it("does not let a General Manager disable, enable or reset an Organization Admin", async () => {
    const gm = await createUser(org, "orggm", [{ role: "GENERAL_MANAGER" }]);
    const gmJar = await loginAs(gm.email, TEST_PASSWORD);
    const denied = await userAction(disableRoute, "disable", adminId, gmJar);
    expect(denied.status).toBe(403);
    expect(denied.body.error.details.reason).toBe("TARGET_OUTRANKS_CALLER");
    expect(denied.body.error.details.missingPermissions).toEqual(
      expect.arrayContaining(["properties:manage", "roles:manage"]),
    );
    expect((await userAction(resetIssueRoute, "password-reset", adminId, gmJar)).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).status).toBe("ACTIVE");
    // A GM may still manage users below them.
    const agent = await createUser(org, "gmtarget", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    expect((await userAction(disableRoute, "disable", agent.id, gmJar)).status).toBe(200);
    expect((await userAction(enableRoute, "enable", agent.id, gmJar)).status).toBe(200);
  });

  it("lets an equal or superior administrator disable and re-enable, audited", async () => {
    const peer = await createUser(org, "peeradmin", [{ role: "ORGANIZATION_ADMIN" }]);
    const peerJar = await loginAs(peer.email, TEST_PASSWORD);
    const disabled = await userAction(disableRoute, "disable", peer.id, adminJar);
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.status).toBe("DISABLED");
    // Sessions are gone and the account cannot sign in.
    expect((await me(peerJar)).status).toBe(401);
    expect((await refreshWith(peerJar)).status).toBe(401);
    expect((await attempt(peer.email, TEST_PASSWORD)).status).toBe(401);
    // Unlock is not enable.
    expect((await userAction(unlockRoute, "unlock", peer.id, adminJar)).status).toBe(422);

    const enabled = await userAction(enableRoute, "enable", peer.id, adminJar);
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.status).toBe("ACTIVE");
    // The old session stays dead; a fresh sign-in works.
    expect((await me(peerJar)).status).toBe(401);
    const fresh = await loginAs(peer.email, TEST_PASSWORD);
    expect((await me(fresh)).status).toBe(200);
    const audits = await prisma.auditLog.findMany({
      where: { resourceId: peer.id, action: { in: ["user.disable", "user.enable"] } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(["user.disable", "user.enable"]);
    expect(audits.every((a) => a.risk === "HIGH")).toBe(true);
    // Enabling an active user is refused.
    expect((await userAction(enableRoute, "enable", peer.id, adminJar)).status).toBe(422);
  });

  it("refuses self-disable and protects platform super admins", async () => {
    expect((await userAction(disableRoute, "disable", adminId, adminJar)).status).toBe(403);
    const platform = await createUser(org, "superadmin", []);
    await prisma.user.update({ where: { id: platform.id }, data: { isSuperAdmin: true } });
    const denied = await userAction(disableRoute, "disable", platform.id, adminJar);
    expect(denied.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: platform.id } })).status).toBe(
      "ACTIVE",
    );
  });

  it("never lets concurrent disables leave the organization without an administrator", async () => {
    const solo = await createFixtureOrg({ properties: [{ key: "S", timezone: "Asia/Karachi" }] });
    const x = await loginAs(`admin.${solo.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
    const yUser = await createUser(solo, "adminy", [{ role: "ORGANIZATION_ADMIN" }]);
    const y = await loginAs(yUser.email, TEST_PASSWORD);
    const [a, b] = await Promise.all([
      userAction(disableRoute, "disable", yUser.id, x),
      userAction(disableRoute, "disable", solo.adminId, y),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect([a.status, b.status].some((s) => s === 403 || s === 422)).toBe(true);
    const active = await prisma.user.count({
      where: { organizationId: solo.organizationId, status: "ACTIVE" },
    });
    expect(active).toBe(1);
  });

  it("never lets a concurrent revoke and disable remove both administrators", async () => {
    const duo = await createFixtureOrg({ properties: [{ key: "D", timezone: "Asia/Karachi" }] });
    const x = await loginAs(`admin.${duo.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
    const yUser = await createUser(duo, "adminy", [{ role: "ORGANIZATION_ADMIN" }]);
    const y = await loginAs(yUser.email, TEST_PASSWORD);
    const xAssignment = await prisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: duo.adminId, scope: "ORGANIZATION" },
    });
    const [revoke, disable] = await Promise.all([
      call(revokeRoute, {
        method: "DELETE",
        path: `/api/v1/users/${duo.adminId}/role-assignments/${xAssignment.id}`,
        params: { userId: duo.adminId, assignmentId: xAssignment.id },
        body: reason,
        jar: y,
      }),
      userAction(disableRoute, "disable", yUser.id, x),
    ]);
    expect([revoke.status, disable.status].filter((s) => s === 200)).toHaveLength(1);
    // Whatever order won, one active holder of the administrator permissions remains.
    const admins = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT u."id")::int AS "n" FROM "users" u
      JOIN "user_role_assignments" a ON a."user_id" = u."id" AND a."scope" = 'ORGANIZATION'
      JOIN "role_permissions" rp ON rp."role_id" = a."role_id" AND rp."permission_key" = 'roles:manage'
      WHERE u."organization_id" = ${duo.organizationId}::uuid AND u."status" = 'ACTIVE'`;
    expect(admins[0]!.n).toBe(1);
  });
});

// --- H4 -----------------------------------------------------------------------------------

describe("H4 password change", () => {
  it("verifies the current password, revokes every other session and issues a new one", async () => {
    const user = await createUser(org, "changer", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const jar = await loginAs(user.email, TEST_PASSWORD);
    const other = await loginAs(user.email, TEST_PASSWORD);
    const stolen = copyJar(jar); // tokens copied before the change

    const change = (body: Record<string, unknown>) =>
      call(changePasswordRoute, { method: "POST", path: "/api/v1/auth/password", body, jar });
    const wrong = await change({ currentPassword: "not-it", newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.fields.currentPassword).toBeDefined();
    expect((await change({ currentPassword: TEST_PASSWORD, newPassword: "short" })).status).toBe(
      400,
    );
    expect(
      (await change({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD })).status,
    ).toBe(400);

    const ok = await change({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain(NEW_PASSWORD);
    // This browser continues on its fresh session; everything older is dead.
    expect((await me(jar)).status).toBe(200);
    expect((await me(other)).status).toBe(401);
    expect((await refreshWith(other)).status).toBe(401);
    expect((await me(stolen)).status).toBe(401);
    expect((await refreshWith(stolen)).status).toBe(401);
    expect((await attempt(user.email, TEST_PASSWORD)).status).toBe(401);
    expect((await attempt(user.email, NEW_PASSWORD)).status).toBe(200);

    const audits = await prisma.auditLog.findMany({ where: { resourceId: user.id } });
    const changed = audits.find((a) => a.action === "auth.password_change")!;
    expect(changed.risk).toBe("HIGH");
    expect(audits.some((a) => a.action === "auth.password_change_failed")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(audits)).not.toContain(TEST_PASSWORD);
  });

  it("rate-limits password change attempts per user", async () => {
    const user = await createUser(org, "changelimit", [
      { role: "FRONT_DESK_AGENT", property: "A" },
    ]);
    const jar = await loginAs(user.email, TEST_PASSWORD);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await call(changePasswordRoute, {
            method: "POST",
            path: "/api/v1/auth/password",
            body: { currentPassword: `wrong-${i}`, newPassword: NEW_PASSWORD },
            jar,
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("rejects any session opened before the current password was set", async () => {
    const user = await createUser(org, "stale", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const jar = await loginAs(user.email, TEST_PASSWORD);
    expect((await me(jar)).status).toBe(200);
    // Simulate a password set later without an explicit revocation.
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordChangedAt: new Date(Date.now() + 1_000) },
    });
    expect((await me(jar)).status).toBe(401);
    expect((await refreshWith(jar)).status).toBe(401);
  });
});

describe("H4 administrator reset", () => {
  async function issue(userId: string, jar = adminJar) {
    return userAction(resetIssueRoute, "password-reset", userId, jar);
  }
  const complete = (token: string, newPassword = NEW_PASSWORD) =>
    call(resetCompleteRoute, {
      method: "POST",
      path: "/api/v1/auth/password/reset",
      body: { token, newPassword },
    });
  const tokenOf = (resetUrl: string) => new URL(resetUrl).hash.replace(/^#token=/, "");

  it("issues a single-use link, revokes sessions and the old password, never stores the token", async () => {
    const user = await createUser(org, "resetme", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const jar = await loginAs(user.email, TEST_PASSWORD);
    const issued = await issue(user.id);
    expect(issued.status).toBe(201);
    expect(issued.response.headers.get("cache-control")).toBe("no-store");
    const token = tokenOf(issued.body.data.resetUrl);
    expect(issued.body.data.resetUrl).toMatch(/\/reset-password#token=/);
    expect(new Date(issued.body.data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      30 * 60_000,
    );

    // Signed out everywhere; the old password no longer works.
    expect((await me(jar)).status).toBe(401);
    expect((await attempt(user.email, TEST_PASSWORD)).status).toBe(401);
    // Only a keyed hash is stored, and the raw token is in no audit row.
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).toBe(hashOpaqueToken(token));
    expect(stored.tokenHash).not.toBe(token);
    const audits = await prisma.auditLog.findMany({ where: { resourceId: user.id } });
    expect(JSON.stringify(audits)).not.toContain(token);
    expect(audits.find((a) => a.action === "user.password_reset_issue")?.risk).toBe("HIGH");

    expect((await complete(token)).status).toBe(200);
    expect((await attempt(user.email, NEW_PASSWORD)).status).toBe(200);
    // Single use.
    const again = await complete(token, "Another-password-99");
    expect(again.status).toBe(400);
    expect(again.body.error.details.reason).toBe("RESET_TOKEN_INVALID");
    expect(
      (
        await prisma.auditLog.findFirst({
          where: { resourceId: user.id, action: "auth.password_reset_complete" },
        })
      )?.risk,
    ).toBe("HIGH");
  });

  it("accepts a token exactly once under concurrent use, and not after expiry", async () => {
    const user = await createUser(org, "resetrace", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const token = tokenOf((await issue(user.id)).body.data.resetUrl);
    const results = await Promise.all([complete(token), complete(token, "Second-password-77")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);

    const late = await createUser(org, "resetlate", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const lateToken = tokenOf((await issue(late.id)).body.data.resetUrl);
    await prisma.passwordResetToken.updateMany({
      where: { userId: late.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await complete(lateToken)).status).toBe(400);
  });

  it("invalidates earlier links when a new one is issued, and refuses disabled users", async () => {
    const user = await createUser(org, "relink", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const first = tokenOf((await issue(user.id)).body.data.resetUrl);
    const second = tokenOf((await issue(user.id)).body.data.resetUrl);
    expect((await complete(first)).status).toBe(400);
    // Disabled after the link was issued: the link no longer works.
    await userAction(disableRoute, "disable", user.id, adminJar);
    expect((await complete(second)).status).toBe(400);
    expect((await issue(user.id)).status).toBe(422);
    // Self-reset goes through password change instead.
    expect((await issue(adminId)).status).toBe(403);
  });
});
