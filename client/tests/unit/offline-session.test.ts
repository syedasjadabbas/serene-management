import { beforeEach, describe, expect, it } from "vitest";
import { resetBootForTests } from "@/global/api/session";
import { API_BASE_URL } from "@/global/constants/api";
import { checkSession } from "@/global/lib/offline/verifySession";
import { useAuthStore } from "@/global/stores/auth.store";

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
const REFRESHED = { success: true, data: { accessToken: "token-2", expiresIn: 900 } };

const ME_URL = `${API_BASE_URL}/me`;
const REFRESH_URL = `${API_BASE_URL}/auth/refresh`;

function fetcher(responses: Record<string, (Response | Error)[]>) {
  const calls: string[] = [];
  const authorizations: (string | null)[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push(url);
    authorizations.push(new Headers(init?.headers).get("authorization"));
    const next = responses[url]?.shift();
    if (!next) throw new Error(`unexpected ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls, authorizations };
}

describe("offline view session check", () => {
  beforeEach(() => {
    resetBootForTests();
    useAuthStore.setState({ accessToken: "token-1", status: "authenticated" });
  });

  it("is valid when /me answers, sending the access token", async () => {
    const f = fetcher({ [ME_URL]: [json(200, { data: ME })] });
    expect(await checkSession(f.fn)).toEqual({ state: "valid", me: ME });
    expect(f.authorizations).toEqual(["Bearer token-1"]);
  });

  it("refreshes an expired access token once, then confirms with the new one", async () => {
    const f = fetcher({
      [ME_URL]: [json(401), json(200, { data: ME })],
      [REFRESH_URL]: [json(200, REFRESHED)],
    });
    expect((await checkSession(f.fn)).state).toBe("valid");
    expect(f.calls).toEqual([ME_URL, REFRESH_URL, ME_URL]);
    expect(f.authorizations[2]).toBe("Bearer token-2");
  });

  it("is ended when neither the access token nor the refresh cookie is valid", async () => {
    const f = fetcher({ [ME_URL]: [json(401)], [REFRESH_URL]: [json(401)] });
    expect(await checkSession(f.fn)).toEqual({ state: "ended" });
  });

  it("is ended when the refreshed session is still refused (disabled user, revoked access)", async () => {
    const f = fetcher({
      [ME_URL]: [json(401), json(403)],
      [REFRESH_URL]: [json(200, REFRESHED)],
    });
    expect(await checkSession(f.fn)).toEqual({ state: "ended" });
  });

  it("is unreachable on a network failure or a server error: the device is offline", async () => {
    expect(await checkSession(fetcher({ [ME_URL]: [new TypeError("fetch failed")] }).fn)).toEqual({
      state: "unreachable",
    });
    expect(await checkSession(fetcher({ [ME_URL]: [json(503)] }).fn)).toEqual({
      state: "unreachable",
    });
  });

  it("is unreachable when the refresh itself cannot be answered", async () => {
    const f = fetcher({ [ME_URL]: [json(401)], [REFRESH_URL]: [json(503)] });
    expect(await checkSession(f.fn)).toEqual({ state: "unreachable" });
  });
});
