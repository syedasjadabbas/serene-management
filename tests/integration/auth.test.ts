import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { GET as sessionsRoute } from "@/app/api/v1/auth/sessions/route";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { POST as disableRoute } from "@/app/api/v1/users/[userId]/disable/route";
import { ACCESS_COOKIE, REFRESH_COOKIE, SESSION_MARKER_COOKIE } from "@/lib/auth/cookies";
import { hashOpaqueToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db/prisma";
import { refresh } from "@/modules/identity/identity.service";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  auditLogsFor,
  createFixtureOrg,
  createUser,
} from "./support/fixtures";
import { CookieJar, call, loginAs, testIp } from "./support/http";

let org: FixtureOrg;
let agent: { id: string; email: string };

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  agent = await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
});

describe("login", () => {
  it("signs in with valid credentials and sets secure httpOnly cookies", async () => {
    const jar = new CookieJar();
    const result = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: agent.email.toUpperCase(), password: TEST_PASSWORD },
      jar,
    });
    expect(result.status).toBe(200);
    expect(result.body.data.user).toEqual({
      id: agent.id,
      displayName: expect.any(String),
      email: agent.email,
    });
    expect(JSON.stringify(result.body)).not.toMatch(/password|hash/i);

    const setCookies = result.response.headers.getSetCookie();
    const access = setCookies.find((c) => c.startsWith(`${ACCESS_COOKIE}=`))!;
    const refreshCookie = setCookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=lax/i);
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/SameSite=strict/i);
    expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(jar.get(SESSION_MARKER_COOKIE)).toBe("1");

    // Only a keyed hash of the refresh token is stored.
    const stored = await prisma.authSession.findFirst({
      where: { refreshTokenHash: hashOpaqueToken(jar.get(REFRESH_COOKIE)!) },
      select: { userId: true },
    });
    expect(stored?.userId).toBe(agent.id);
  });

  it("rejects a wrong password and an unknown email with the same generic error", async () => {
    const wrong = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: agent.email, password: "not-the-password" },
    });
    const unknown = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: `nobody.${org.suffix.toLowerCase()}@serene.test`, password: "whatever-123" },
    });
    for (const result of [wrong, unknown]) {
      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe("UNAUTHENTICATED");
      expect(result.body.error.message).toBe("Invalid email or password.");
      expect(result.body.error.requestId).toEqual(expect.any(String));
    }
    await prisma.user.update({ where: { id: agent.id }, data: { failedLoginCount: 0 } });
  });

  it("locks the account after 5 consecutive failures, even for the right password", async () => {
    const victim = await createUser(org, "lockme", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
    for (let i = 0; i < 5; i++) {
      const r = await call(loginRoute, {
        method: "POST",
        path: "/api/v1/auth/login",
        body: { email: victim.email, password: `wrong-${i}` },
      });
      expect(r.status).toBe(401);
    }
    const blocked = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: victim.email, password: TEST_PASSWORD },
    });
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.message).toBe("Invalid email or password.");

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
    const r = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: disabled.email, password: TEST_PASSWORD },
    });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe("Invalid email or password.");
  });

  it("validates the request body", async () => {
    const r = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: "x" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("session validation", () => {
  it("rejects protected endpoints without authentication", async () => {
    const r = await call(meRoute, { path: "/api/v1/me" });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a forged access token", async () => {
    const jar = new CookieJar();
    jar.set(ACCESS_COOKIE, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid-signature");
    expect((await call(meRoute, { path: "/api/v1/me", jar })).status).toBe(401);
  });

  it("returns the caller's identity and property permissions", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const r = await call(meRoute, { path: "/api/v1/me", jar });
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
  it("revokes the session immediately and clears cookies", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const accessToken = jar.get(ACCESS_COOKIE)!;
    const out = await call(logoutRoute, { method: "POST", path: "/api/v1/auth/logout", jar });
    expect(out.status).toBe(200);
    expect(jar.get(ACCESS_COOKIE)).toBeUndefined();
    expect(jar.get(REFRESH_COOKIE)).toBeUndefined();

    // The still-unexpired access token is useless once the session is revoked.
    const replay = new CookieJar();
    replay.set(ACCESS_COOKIE, accessToken);
    expect((await call(meRoute, { path: "/api/v1/me", jar: replay })).status).toBe(401);
  });

  it("is idempotent without a session", async () => {
    expect((await call(logoutRoute, { method: "POST", path: "/api/v1/auth/logout" })).status).toBe(
      200,
    );
  });
});

describe("refresh token rotation", () => {
  it("rotates the refresh token and keeps the session usable", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const first = jar.get(REFRESH_COOKIE)!;
    const r = await call(refreshRoute, { method: "POST", path: "/api/v1/auth/refresh", jar });
    expect(r.status).toBe(200);
    expect(jar.get(REFRESH_COOKIE)).not.toBe(first);
    expect((await call(meRoute, { path: "/api/v1/me", jar })).status).toBe(200);
  });

  it("revokes the whole session when a rotated-away token is replayed", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const stolen = jar.get(REFRESH_COOKIE)!;
    await call(refreshRoute, { method: "POST", path: "/api/v1/auth/refresh", jar });

    // Replay of the old token after the race window = theft.
    const meta = { requestId: "reuse-test", ipAddress: testIp(), userAgent: "attacker" };
    await expect(refresh(meta, stolen, new Date(Date.now() + 60_000))).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    // The legitimate holder is signed out too.
    expect((await call(meRoute, { path: "/api/v1/me", jar })).status).toBe(401);
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
    const token = jar.get(REFRESH_COOKIE)!;
    const meta = { requestId: "race-test", ipAddress: testIp(), userAgent: "tab-2" };
    await refresh(meta, token);
    const second = await refresh(meta, token);
    expect(second.accessToken).toEqual(expect.any(String));
    expect(second.refreshToken).toBeUndefined();
  });

  it("clears cookies when the refresh token is unknown", async () => {
    const jar = new CookieJar();
    jar.set(REFRESH_COOKIE, "not-a-real-token");
    const r = await call(refreshRoute, { method: "POST", path: "/api/v1/auth/refresh", jar });
    expect(r.status).toBe(401);
    expect(r.response.headers.getSetCookie().some((c) => c.startsWith(`${REFRESH_COOKIE}=;`))).toBe(
      true,
    );
  });
});

describe("sessions and account state", () => {
  it("lists only the caller's own sessions", async () => {
    const jar = await loginAs(agent.email, TEST_PASSWORD);
    const r = await call(sessionsRoute, { path: "/api/v1/auth/sessions", jar });
    expect(r.status).toBe(200);
    expect(r.body.data.some((s: { current: boolean }) => s.current)).toBe(true);
  });

  it("signs a disabled user out everywhere", async () => {
    const victim = await createUser(org, "tobedisabled", [
      { role: "FRONT_DESK_AGENT", property: "A" },
    ]);
    const victimJar = await loginAs(victim.email, TEST_PASSWORD);
    const adminJar = await loginAs(`admin.${org.suffix.toLowerCase()}@serene.test`, TEST_PASSWORD);

    const r = await call(disableRoute, {
      method: "POST",
      path: `/api/v1/users/${victim.id}/disable`,
      params: { userId: victim.id },
      body: { reason: "Left the company" },
      jar: adminJar,
    });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("DISABLED");
    expect((await call(meRoute, { path: "/api/v1/me", jar: victimJar })).status).toBe(401);
    const audit = await auditLogsFor(victim.id);
    expect(audit.find((a) => a.action === "user.disable")).toMatchObject({
      risk: "HIGH",
      reason: "Left the company",
    });
  });
});

describe("CSRF protection", () => {
  it("rejects state-changing requests without our Origin", async () => {
    const noOrigin = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: agent.email, password: TEST_PASSWORD },
      noOrigin: true,
    });
    expect(noOrigin.status).toBe(403);
    const foreign = await call(loginRoute, {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { email: agent.email, password: TEST_PASSWORD },
      headers: { origin: "https://evil.example" },
      noOrigin: true,
    });
    expect(foreign.status).toBe(403);
  });
});
