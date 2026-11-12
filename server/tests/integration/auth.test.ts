import { beforeAll, describe, expect, it } from "vitest";
import { hashOpaqueToken } from "@/lib/jwt";
import { prisma } from "@/config/prisma";
import { disableUser } from "@/modules/users/users.service";
import { refresh } from "@/modules/identity/identity.service";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  auditLogsFor,
  createFixtureOrg,
  createUser,
} from "./support/fixtures";
import { REFRESH_COOKIE, Session, call, contextFor, loginAs, route, testIp } from "./support/http";

const login = route("POST", "/auth/login");
const logout = route("POST", "/auth/logout");
const refreshRoute = route("POST", "/auth/refresh");
const sessionsRoute = route("GET", "/auth/sessions");
const me = route("GET", "/me");

let org: FixtureOrg;
let agent: { id: string; email: string };

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  agent = await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
});

describe("login", () => {
  it("returns a Bearer token and sets only the secure httpOnly refresh cookie", async () => {
    const jar = new Session();
    const result = await call(login, {
      body: { email: agent.email.toUpperCase(), password: TEST_PASSWORD },
      jar,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, message: "OK" });
    expect(result.body.data).toEqual({
      accessToken: expect.any(String),
      expiresIn: 900,
      user: { id: agent.id, displayName: expect.any(String), email: agent.email },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/password|hash/i);

    const setCookies = result.response.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    const refreshCookie = setCookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/SameSite=strict/i);
    expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/);

    // Only a keyed hash of the refresh token is stored.
    const stored = await prisma.authSession.findFirst({
      where: { refreshTokenHash: hashOpaqueToken(jar.refreshToken!) },
      select: { userId: true, platform: true },
    });
    expect(stored).toEqual({ userId: agent.id, platform: "web" });
  });

  it("rejects a wrong password and an unknown email with the same generic error", async () => {
    const wrong = await call(login, { body: { email: agent.email, password: "not-the-password" } });
    const unknown = await call(login, {
      body: { email: `nobody.${org.suffix.toLowerCase()}@serene.test`, password: "whatever-123" },
    });
    for (const result of [wrong, unknown]) {
      expect(result.status).toBe(401);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe("UNAUTHENTICATED");
      expect(result.body.message).toBe("Invalid email or password.");
      expect(result.body.error.requestId).toEqual(expect.any(String));
    }
    await prisma.user.update({ where: { id: agent.id }, data: { failedLoginCount: 0 } });
  });

  it("locks the account after 5 consecutive failures, even for the right password", async () => {
    const victim = await createUser(org, "lockme", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    for (let i = 0; i < 5; i++) {
      const r = await call(login, { body: { email: victim.email, password: `wrong-${i}` } });
      expect(r.status).toBe(401);
    }
    const blocked = await call(login, { body: { email: victim.email, password: TEST_PASSWORD } });
    expect(blocked.status).toBe(401);
    expect(blocked.body.message).toBe("Invalid email or password.");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const audits = await auditLogsFor(victim.id);
    expect(audits.filter((a) => a.action === "auth.login_failed")).toHaveLength(5);
    expect(audits.find((a) => a.action === "auth.account_locked")?.risk).toBe("HIGH");
    expect(audits.find((a) => a.action === "auth.login_rejected")).toBeDefined();
  });

  it("rejects disabled users with the generic error", async () => {
    const disabled = await createUser(org, "disabled", [{ role: "READ_ONLY", property: "A" }], {
      status: "DISABLED",
    });
    const r = await call(login, { body: { email: disabled.email, password: TEST_PASSWORD } });
    expect(r.status).toBe(401);
    expect(r.body.message).toBe("Invalid email or password.");
  });

  it("validates the request body", async () => {
    const r = await call(login, { body: { email: "x" } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("keeps one active session per user per platform", async () => {
    const user = await createUser(org, "platforms", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    const web1 = await loginAs(user.email, TEST_PASSWORD);
    const mobile = await loginAs(user.email, TEST_PASSWORD, { platform: "mobile" });
    // A second web login ends the first web session, not the mobile one.
    const web2 = await loginAs(user.email, TEST_PASSWORD);
    expect((await call(me, { jar: web1 })).status).toBe(401);
    expect((await call(me, { jar: web1 })).body.error.details.reason).toBe("SESSION_REVOKED");
    expect((await call(me, { jar: web2 })).status).toBe(200);
    expect((await call(me, { jar: mobile })).status).toBe(200);

    const rows = await prisma.authSession.findMany({
      where: { userId: user.id },
      select: { platform: true, revokedAt: true, revokedReason: true },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => [r.platform, r.revokedReason])).toEqual([
      ["web", "SUPERSEDED_BY_LOGIN"],
      ["mobile", null],
      ["web", null],
    ]);
    const audits = await auditLogsFor(user.id);
    expect(audits.filter((a) => a.action === "auth.session_revoke")).toHaveLength(0);
    const revokeAudits = await prisma.auditLog.count({
      where: { action: "auth.session_revoke", userId: user.id },
    });
    expect(revokeAudits).toBe(1);
  });
});

describe("session validation", () => {
  it("rejects protected endpoints without authentication", async () => {
    const r = await call(me);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
    expect(r.body.error.details.reason).toBe("TOKEN_MISSING");
  });

  it("rejects a forged access token", async () => {
    const jar = new Session();
    jar.accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid-signature";
    const r = await call(me, { jar });
    expect(r.status).toBe(401);
    expect(r.body.error.details.reason).toBe("TOKEN_INVALID");
  });

  it("returns the caller's identity and property permissions", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const r = await call(me, { jar });
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe(agent.email);
    expect(r.body.data.organization.id).toBe(org.organizationId);
    expect(r.body.data.properties).toHaveLength(1);
    expect(r.body.data.properties[0].id).toBe(org.properties.A!.id);
    expect(r.body.data.properties[0].permissions).toContain("frontdesk:checkin");
    expect(r.body.data.organizationPermissions).toEqual([]);
    expect(r.response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("logout", () => {
  it("revokes the session immediately and clears the refresh cookie", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const accessToken = jar.accessToken!;
    const out = await call(logout, { jar });
    expect(out.status).toBe(200);
    expect(jar.refreshToken).toBeUndefined();

    // The still-unexpired access token is useless once the session is revoked.
    const replay = new Session();
    replay.accessToken = accessToken;
    const r = await call(me, { jar: replay });
    expect(r.status).toBe(401);
    expect(r.body.error.details.reason).toBe("SESSION_REVOKED");
  });

  it("is idempotent without a session", async () => {
    expect((await call(logout)).status).toBe(200);
  });
});

describe("refresh token rotation", () => {
  it("rotates the refresh token and returns a new access token", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const first = jar.refreshToken!;
    const r = await call(refreshRoute, { jar });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ accessToken: expect.any(String), expiresIn: 900 });
    expect(jar.refreshToken).not.toBe(first);
    expect((await call(me, { jar })).status).toBe(200);
  });

  it("revokes the whole session when a rotated-away token is replayed", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const stolen = jar.refreshToken!;
    await call(refreshRoute, { jar });

    // Replay of the old token after the race window = theft.
    const meta = { requestId: "reuse-test", ipAddress: testIp(), userAgent: "attacker" };
    await expect(refresh(meta, stolen, new Date(Date.now() + 60_000))).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    // The legitimate holder is signed out too (the session cache was invalidated).
    expect((await call(me, { jar })).status).toBe(401);
    const session = await prisma.authSession.findFirst({
      where: { previousTokenHash: hashOpaqueToken(stolen) },
      select: { id: true, revokedReason: true },
    });
    expect(session?.revokedReason).toBe("REFRESH_TOKEN_REUSE");
    const audit = await auditLogsFor(session!.id);
    expect(audit.find((a) => a.action === "auth.refresh_token_reuse")?.risk).toBe("HIGH");
  });

  it("tolerates a concurrent refresh with the same token (race window)", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const token = jar.refreshToken!;
    const meta = { requestId: "race-test", ipAddress: testIp(), userAgent: "tab-2" };
    await refresh(meta, token);
    const second = await refresh(meta, token);
    expect(second.accessToken).toEqual(expect.any(String));
    expect(second.refreshToken).toBeUndefined();
  });

  it("clears the cookie and answers 401 in the envelope when the refresh token is unknown", async () => {
    const jar = new Session();
    jar.set(REFRESH_COOKIE, "not-a-real-token");
    const r = await call(refreshRoute, { jar });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
    expect(r.response.headers.getSetCookie().some((c) => c.startsWith(`${REFRESH_COOKIE}=;`))).toBe(
      true,
    );
  });

  it("answers 401 without a refresh cookie", async () => {
    const r = await call(refreshRoute);
    expect(r.status).toBe(401);
  });
});

describe("sessions and account state", () => {
  it("lists only the caller's own sessions", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const r = await call(sessionsRoute, { jar });
    expect(r.status).toBe(200);
    expect(r.body.data.some((s: { current: boolean }) => s.current)).toBe(true);
  });

  it("signs a disabled user out everywhere", async () => {
    const victim = await createUser(org, "tobedisabled", [
      { role: "FRONT_DESK_AGENT", property: "A" },
    ]);
    const victimJar = await loginAs(victim.email, TEST_PASSWORD);
    const adminJar = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);
    // Warm the session cache: the revocation must still apply on the very next request.
    expect((await call(me, { jar: victimJar })).status).toBe(200);

    const view = await disableUser(await contextFor(adminJar), victim.id, {
      reason: "Left the company",
    });
    expect(view.status).toBe("DISABLED");
    const r = await call(me, { jar: victimJar });
    expect(r.status).toBe(401);
    const audit = await auditLogsFor(victim.id);
    expect(audit.find((a) => a.action === "user.disable")).toMatchObject({
      risk: "HIGH",
      reason: "Left the company",
    });
  });
});

describe("CSRF protection (cookie endpoints only)", () => {
  it("rejects refresh and logout without our Origin", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    for (const target of [refreshRoute, logout]) {
      expect((await call(target, { jar, noOrigin: true })).status).toBe(403);
      const foreign = await call(target, {
        jar,
        headers: { origin: "https://evil.example" },
        noOrigin: true,
      });
      expect(foreign.status).toBe(403);
    }
    // The session survived the rejected attempts.
    expect((await call(me, { jar })).status).toBe(200);
  });

  it("does not require an Origin for Bearer requests", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    expect((await call(me, { jar, noOrigin: true })).status).toBe(200);
    expect((await call(route("DELETE", "/me/avatar"), { jar, noOrigin: true })).status).toBe(200);
  });
});
