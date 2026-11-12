import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedOrigin, isTrustedDevHostname } from "@/lib/origin";

/** CSRF origins of the cookie endpoints (L3) and the refresh cookie's name (L4). */

const production = { CLIENT_ORIGINS: ["https://pms.example-hotel.com"], NODE_ENV: "production" };

describe("allowed origins (L3)", () => {
  it("accepts only CLIENT_ORIGINS in production, whatever the Origin looks like", () => {
    expect(isAllowedOrigin("https://pms.example-hotel.com", production)).toBe(true);
    for (const origin of [
      "https://rebound.attacker.example",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://192.168.18.92:3000",
      undefined,
    ]) {
      expect(isAllowedOrigin(origin, production), String(origin)).toBe(false);
    }
  });

  it("accepts several configured origins", () => {
    const env = {
      CLIENT_ORIGINS: ["https://a.example", "https://b.example"],
      NODE_ENV: "production",
    };
    expect(isAllowedOrigin("https://a.example", env)).toBe(true);
    expect(isAllowedOrigin("https://b.example", env)).toBe(true);
    expect(isAllowedOrigin("https://c.example", env)).toBe(false);
  });
});

describe("development origins: explicit allowlist, not whatever the Origin says (DNS rebinding)", () => {
  const dev = { CLIENT_ORIGINS: ["http://192.168.18.92:3000"], NODE_ENV: "development" };
  const accepts = (origin: string, env = dev) => isAllowedOrigin(origin, env);

  it("accepts loopback: localhost, 127.0.0.1, [::1] and *.localhost, on any port", () => {
    expect(accepts("http://localhost:3000")).toBe(true);
    expect(accepts("http://localhost:3001")).toBe(true);
    expect(accepts("http://127.0.0.1:3000")).toBe(true);
    expect(accepts("http://[::1]:3000")).toBe(true);
    expect(accepts("http://pms.localhost:3000")).toBe(true);
  });

  it("accepts this PC's LAN address and any other 192.168.x.y", () => {
    expect(accepts("http://192.168.18.92:3000")).toBe(true);
    // A new DHCP lease works without editing CLIENT_ORIGINS.
    const stale = { CLIENT_ORIGINS: ["http://192.168.18.170:3000"], NODE_ENV: "development" };
    expect(accepts("http://192.168.18.92:3000", stale)).toBe(true);
    expect(accepts("http://192.168.1.5:3000")).toBe(true);
    expect(accepts("http://192.168.0.255:3000")).toBe(true);
  });

  it("rejects a DNS-rebinding page: the Origin names the attacker's hostname", () => {
    for (const evil of [
      "evil.example:3000",
      "192.168.18.92.evil.example:3000",
      "localhost.evil.example:3000",
      "192.168.18.92.nip.io:3000",
    ]) {
      expect(accepts(`http://${evil}`), evil).toBe(false);
    }
  });

  it("rejects foreign or malformed origins and look-alike addresses", () => {
    expect(accepts("http://evil.example")).toBe(false);
    expect(accepts("http://192.168.18.93:3000")).toBe(true); // any 192.168.x.y
    expect(accepts("http://10.0.0.5:3000")).toBe(false);
    expect(accepts("http://172.16.0.5:3000")).toBe(false);
    expect(accepts("http://192.168.300.1:3000")).toBe(false);
    expect(accepts("http://192.168.18:3000")).toBe(false);
    expect(accepts("http://8.8.8.8:3000")).toBe(false);
    expect(accepts("http://0.0.0.0:3000")).toBe(false);
    expect(accepts("null")).toBe(false);
    expect(accepts("not a url")).toBe(false);
    // Paths and trailing slashes are not origins.
    expect(accepts("http://localhost:3000/")).toBe(false);
    expect(accepts("http://localhost:3000/x")).toBe(false);
  });

  it("lists exactly the allowlisted hostnames", () => {
    for (const ok of [
      "localhost",
      "LOCALHOST",
      "app.localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
      "192.168.18.92",
      "192.168.0.1",
    ]) {
      expect(isTrustedDevHostname(ok), ok).toBe(true);
    }
    for (const bad of [
      "evil.example",
      "localhost.evil.example",
      "127.0.0.2",
      "10.0.0.1",
      "192.168.1",
      "192.168.1.256",
      "192.168.18.92.nip.io",
      "0.0.0.0",
      "",
    ]) {
      expect(isTrustedDevHostname(bad), bad).toBe(false);
    }
  });
});

describe("refresh cookie (L4)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is __Secure- prefixed and Secure in production, path-scoped to the auth endpoints", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookies = await import("@/lib/auth/cookies");
    // Path-scoped (/api/v1/auth), so __Host- is not allowed: __Secure-.
    expect(cookies.refreshCookieName()).toBe("__Secure-sm_rt");
    expect(cookies.REFRESH_COOKIE_PATH).toBe("/api/v1/auth");
  });

  it("keeps the plain name over http in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookies = await import("@/lib/auth/cookies");
    expect(cookies.refreshCookieName()).toBe("sm_rt");
  });

  it("sets httpOnly, SameSite=Strict, Path=/api/v1/auth and clears with an expired cookie", async () => {
    const { setRefreshCookie, clearRefreshCookie } = await import("@/lib/auth/cookies");
    const calls: unknown[][] = [];
    const res = { cookie: (...args: unknown[]) => calls.push(args) } as never;
    const expires = new Date(Date.now() + 60_000);
    setRefreshCookie(res, "token", expires);
    clearRefreshCookie(res);
    expect(calls[0]![2]).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      path: "/api/v1/auth",
      expires,
    });
    expect(calls[1]![1]).toBe("");
    expect(calls[1]![2]).toMatchObject({ maxAge: 0, httpOnly: true, path: "/api/v1/auth" });
  });
});
