import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedOrigins } from "@/lib/http/route";

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
