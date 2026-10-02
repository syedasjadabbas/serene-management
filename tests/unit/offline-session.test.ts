import { describe, expect, it } from "vitest";
import { checkSession } from "@/lib/offline/verifySession";

/**
 * Production-readiness audit (P1): the offline view must not show the last
 * user's guest lists once the server says that session is over.
 */
const ME = {
  user: { id: "u1", displayName: "Agent", isSuperAdmin: false },
  properties: [{ id: "p1", permissions: ["frontdesk:read"] }],
};
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

function fetcher(responses: Record<string, (Response | Error)[]>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const next = responses[url]?.shift();
    if (!next) throw new Error(`unexpected ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}

describe("offline view session check", () => {
  it("is valid when /me answers", async () => {
    const f = fetcher({ "/api/v1/me": [json(200, { data: ME })] });
    expect(await checkSession(f.fn)).toEqual({ state: "valid", me: ME });
  });

  it("refreshes an expired access token once, then confirms", async () => {
    const f = fetcher({
      "/api/v1/me": [json(401), json(200, { data: ME })],
      "/api/v1/auth/refresh": [json(200, {})],
    });
    expect((await checkSession(f.fn)).state).toBe("valid");
    expect(f.calls).toEqual(["/api/v1/me", "/api/v1/auth/refresh", "/api/v1/me"]);
  });

  it("is ended when neither the access token nor the refresh cookie is valid", async () => {
    const f = fetcher({ "/api/v1/me": [json(401)], "/api/v1/auth/refresh": [json(401)] });
    expect(await checkSession(f.fn)).toEqual({ state: "ended" });
  });

  it("is ended when the refreshed session is still refused (disabled user, revoked access)", async () => {
    const f = fetcher({
      "/api/v1/me": [json(401), json(403)],
      "/api/v1/auth/refresh": [json(200, {})],
    });
    expect(await checkSession(f.fn)).toEqual({ state: "ended" });
  });

  it("is unreachable on a network failure or a server error: the device is offline", async () => {
    expect(
      await checkSession(fetcher({ "/api/v1/me": [new TypeError("fetch failed")] }).fn),
    ).toEqual({ state: "unreachable" });
    expect(await checkSession(fetcher({ "/api/v1/me": [json(503)] }).fn)).toEqual({
      state: "unreachable",
    });
  });
});
