import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedOrigins, isTrustedDevHostname, requestOwnOrigin } from "@/lib/http/route";

/** Phase 10 final pass: CSRF origins (L3) and cookie name prefixes (L4). */

describe("CSRF origins (L3)", () => {
  it("accepts only APP_URL in production, whatever the Host says", () => {
    const allowed = allowedOrigins(
      { APP_URL: "https://pms.example-hotel.com", NODE_ENV: "production" },
      "https://rebound.attacker.example",
    );
    expect([...allowed]).toEqual(["https://pms.example-hotel.com"]);
  });

  it("also accepts the request's own origin in development and tests", () => {
    const allowed = allowedOrigins(
      { APP_URL: "http://localhost:3000", NODE_ENV: "development" },
      "http://localhost:3001",
    );
    expect(allowed.has("http://localhost:3001")).toBe(true);
    expect(allowed.has("http://localhost:3000")).toBe(true);
  });
});

describe("development origins: explicit allowlist, not whatever Host says (DNS rebinding)", () => {
  // `next dev --hostname 0.0.0.0`: nextUrl carries the bind address.
  const bound = { protocol: "http:", origin: "http://0.0.0.0:3000" };
  const dev = { APP_URL: "http://192.168.18.92:3000", NODE_ENV: "development" };
  /** Mirrors assertSameOrigin: is this Origin accepted when the request carried this Host? */
  const accepts = (origin: string, host: string | null, env = dev) =>
    allowedOrigins(env, requestOwnOrigin(bound, host)).has(origin);

  it("accepts loopback: localhost, 127.0.0.1, [::1] and *.localhost, on any port", () => {
    expect(accepts("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(accepts("http://localhost:3001", "localhost:3001")).toBe(true);
    expect(accepts("http://127.0.0.1:3000", "127.0.0.1:3000")).toBe(true);
    expect(accepts("http://[::1]:3000", "[::1]:3000")).toBe(true);
    expect(accepts("http://pms.localhost:3000", "pms.localhost:3000")).toBe(true);
  });

  it("accepts this PC's LAN address 192.168.18.92 and any other 192.168.x.y", () => {
    expect(accepts("http://192.168.18.92:3000", "192.168.18.92:3000")).toBe(true);
    // A new DHCP lease works without editing APP_URL…
    const stale = { APP_URL: "http://192.168.18.170:3000", NODE_ENV: "development" };
    expect(accepts("http://192.168.18.92:3000", "192.168.18.92:3000", stale)).toBe(true);
    expect(accepts("http://192.168.1.5:3000", "192.168.1.5:3000")).toBe(true);
    expect(accepts("http://192.168.0.255:3000", "192.168.0.255:3000")).toBe(true);
    // …and APP_URL itself always stays accepted.
    expect(accepts("http://192.168.18.92:3000", null)).toBe(true);
  });

  it("rejects a DNS-rebinding page: Origin and Host both name the attacker's hostname", () => {
    for (const evil of [
      "evil.example:3000",
      "192.168.18.92.evil.example:3000",
      "localhost.evil.example:3000",
    ]) {
      expect(accepts(`http://${evil}`, evil), evil).toBe(false);
    }
    // nip.io-style names that embed an allowed address are still foreign hostnames.
    expect(accepts("http://192.168.18.92.nip.io:3000", "192.168.18.92.nip.io:3000")).toBe(false);
  });

  it("rejects foreign or malformed origins and look-alike addresses", () => {
    expect(accepts("http://evil.example", "localhost:3000")).toBe(false);
    expect(accepts("http://192.168.18.92:3000", "evil.example:3000")).toBe(true); // that is APP_URL
    expect(accepts("http://192.168.18.93:3000", "evil.example:3000")).toBe(false);
    expect(accepts("http://10.0.0.5:3000", "10.0.0.5:3000")).toBe(false);
    expect(accepts("http://172.16.0.5:3000", "172.16.0.5:3000")).toBe(false);
    expect(accepts("http://192.168.300.1:3000", "192.168.300.1:3000")).toBe(false);
    expect(accepts("http://192.168.18:3000", "192.168.18:3000")).toBe(false);
    expect(accepts("http://8.8.8.8:3000", "8.8.8.8:3000")).toBe(false);
    expect(accepts("http://0.0.0.0:3000", null)).toBe(false);
    expect(accepts("null", "localhost:3000")).toBe(false);
    expect([...allowedOrigins(dev, "not a url")]).toEqual(["http://192.168.18.92:3000"]);
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

  it("production still accepts APP_URL only, whatever the Host or Origin", () => {
    const prod = { APP_URL: "https://pms.example-hotel.com", NODE_ENV: "production" };
    for (const host of ["localhost:3000", "127.0.0.1:3000", "192.168.18.92:3000", "evil.example"]) {
      expect([
        ...allowedOrigins(
          prod,
          requestOwnOrigin({ protocol: "https:", origin: "https://x" }, host),
        ),
      ]).toEqual(["https://pms.example-hotel.com"]);
      expect(accepts(`http://${host}`, host, prod)).toBe(false);
    }
    expect(accepts("https://pms.example-hotel.com", "evil.example", prod)).toBe(true);
  });
});

describe("auth cookie names (L4)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("use __Host- / __Secure- prefixes in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const cookies = await import("@/lib/auth/cookies");
    expect(cookies.ACCESS_COOKIE).toBe("__Host-sm_at");
    expect(cookies.SESSION_MARKER_COOKIE).toBe("__Host-sm_s");
    // Path-scoped (/api/v1/auth), so __Host- is not allowed: __Secure-.
    expect(cookies.REFRESH_COOKIE).toBe("__Secure-sm_rt");
    expect(cookies.REFRESH_COOKIE_PATH).not.toBe("/");
  });

  it("keep plain names over http in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const cookies = await import("@/lib/auth/cookies");
    expect([cookies.ACCESS_COOKIE, cookies.REFRESH_COOKIE, cookies.SESSION_MARKER_COOKIE]).toEqual([
      "sm_at",
      "sm_rt",
      "sm_s",
    ]);
  });
});
