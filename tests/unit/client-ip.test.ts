import { describe, expect, it } from "vitest";
import { resolveClientIp } from "@/lib/http/client-ip";

const headers = (xff?: string, extra: Record<string, string> = {}) => {
  const h = new Headers(extra);
  if (xff !== undefined) h.set("x-forwarded-for", xff);
  return h;
};

describe("trusted client IP (H2, D44)", () => {
  it("trusts nothing without a configured proxy (direct request)", () => {
    expect(resolveClientIp(headers("203.0.113.9"), 0)).toBeNull();
    expect(resolveClientIp(headers(undefined, { "x-real-ip": "203.0.113.9" }), 0)).toBeNull();
  });

  it("takes the address written by the one trusted proxy", () => {
    expect(resolveClientIp(headers("203.0.113.9"), 1)).toBe("203.0.113.9");
  });

  it("ignores client-supplied entries in front of the proxy's entry", () => {
    // The attacker sends "1.1.1.1"; the proxy appends the real peer address.
    expect(resolveClientIp(headers("1.1.1.1, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(resolveClientIp(headers("10.0.0.1, 8.8.8.8, 203.0.113.9"), 1)).toBe("203.0.113.9");
  });

  it("walks multiple trusted hops from the right", () => {
    // client -> CDN (appends client) -> nginx (appends CDN) -> app
    expect(resolveClientIp(headers("spoof, 203.0.113.9, 198.51.100.1"), 2)).toBe("203.0.113.9");
    expect(resolveClientIp(headers("203.0.113.9, 198.51.100.1"), 2)).toBe("203.0.113.9");
  });

  it("returns null when the chain is shorter than the trusted hops", () => {
    expect(resolveClientIp(headers("203.0.113.9"), 2)).toBeNull();
  });

  it("returns null when the forwarded header is missing or empty", () => {
    expect(resolveClientIp(headers(), 1)).toBeNull();
    expect(resolveClientIp(headers(""), 1)).toBeNull();
    expect(resolveClientIp(headers(" , "), 1)).toBeNull();
  });

  it("never trusts X-Real-IP or garbage entries", () => {
    expect(resolveClientIp(headers(undefined, { "x-real-ip": "203.0.113.9" }), 1)).toBeNull();
    expect(resolveClientIp(headers("1.1.1.1, not-an-ip"), 1)).toBeNull();
    expect(resolveClientIp(headers("<script>"), 1)).toBeNull();
  });

  it("normalizes ports, brackets and IPv6 case", () => {
    expect(resolveClientIp(headers("203.0.113.9:51234"), 1)).toBe("203.0.113.9");
    expect(resolveClientIp(headers("[2001:DB8::1]:443"), 1)).toBe("2001:db8::1");
    expect(resolveClientIp(headers("2001:db8::1"), 1)).toBe("2001:db8::1");
  });
});
