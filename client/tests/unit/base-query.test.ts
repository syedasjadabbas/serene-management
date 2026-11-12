import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseApi } from "@/global/api/baseApi";
import { sessionApi } from "@/global/api/endpoints/sessionApi";
import { resetBootForTests } from "@/global/api/session";
import { makeStore } from "@/global/api/store";
import { API_BASE_URL } from "@/global/constants/api";
import { useAuthStore } from "@/global/stores/auth.store";

const api = baseApi.injectEndpoints({
  endpoints: (build) => ({
    probe: build.query<{ data: unknown; meta?: unknown }, string>({
      query: (path) => path,
    }),
  }),
});

interface Seen {
  url: string;
  method: string;
  authorization: string | null;
  platform: string | null;
}
type Handler = (seen: Seen, count: number) => Response | Promise<Response>;

/** Routes fetch (both `fetch(url, init)` and `fetch(Request)`) through `handler`. */
function mockFetch(handler: Handler) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | Request, init?: RequestInit) => {
      const request = typeof input === "string" ? null : input;
      const headers = new Headers(request?.headers ?? init?.headers);
      const entry: Seen = {
        url: request?.url ?? String(input),
        method: request?.method ?? init?.method ?? "GET",
        authorization: headers.get("authorization"),
        platform: headers.get("x-client-platform"),
      };
      seen.push(entry);
      return handler(entry, seen.length);
    }),
  );
  return seen;
}

const ok = (data: unknown, extra: object = {}) =>
  new Response(JSON.stringify({ success: true, message: "OK", data, ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const fail = (status: number, code: string, message: string, headers: HeadersInit = {}) =>
  new Response(JSON.stringify({ success: false, message, error: { code, requestId: "r1" } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const refreshed = (token: string) => ok({ accessToken: token, expiresIn: 900 });

beforeEach(() => {
  resetBootForTests();
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useAuthStore.getState().setSession("token-1", 900);
});
afterEach(() => vi.unstubAllGlobals());

function run(path: string, store = makeStore()) {
  return store.dispatch(api.endpoints.probe.initiate(path, { forceRefetch: true }));
}

describe("baseApi", () => {
  it("sends Bearer + platform headers to the API base and reduces the envelope", async () => {
    const seen = mockFetch(() => ok([{ id: 1 }], { meta: { nextCursor: null, limit: 25 } }));
    const result = await run("/rooms");
    expect(seen[0]).toMatchObject({
      url: `${API_BASE_URL}/rooms`,
      authorization: "Bearer token-1",
      platform: "web",
    });
    expect(result.data).toEqual({ data: [{ id: 1 }], meta: { nextCursor: null, limit: 25 } });
  });

  it("refreshes once on 401, then retries with the new token", async () => {
    const seen = mockFetch((s) => {
      if (s.url.endsWith("/auth/refresh")) return refreshed("token-2");
      return s.authorization === "Bearer token-2"
        ? ok({ fine: true })
        : fail(401, "SESSION_EXPIRED", "Token expired");
    });
    const result = await run("/me");
    expect(result.data).toEqual({ data: { fine: true } });
    expect(seen.map((s) => s.url.replace(API_BASE_URL, ""))).toEqual([
      "/me",
      "/auth/refresh",
      "/me",
    ]);
    expect(seen[1]).toMatchObject({ method: "POST", platform: "web" });
    expect(useAuthStore.getState().accessToken).toBe("token-2");
  });

  it("runs a single refresh for concurrent 401s", async () => {
    const seen = mockFetch(async (s) => {
      if (s.url.endsWith("/auth/refresh")) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return refreshed("token-2");
      }
      return s.authorization === "Bearer token-2"
        ? ok({ ok: 1 })
        : fail(401, "SESSION_EXPIRED", "Token expired");
    });
    const store = makeStore();
    const results = await Promise.all([run("/a", store), run("/b", store), run("/c", store)]);
    expect(results.every((r) => r.isSuccess)).toBe(true);
    expect(seen.filter((s) => s.url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("ends the session with the server's reason when the refresh is refused", async () => {
    mockFetch((s) =>
      s.url.endsWith("/auth/refresh")
        ? fail(401, "UNAUTHENTICATED", "No session")
        : fail(401, "SESSION_REVOKED", "Signed in on another device."),
    );
    const result = await run("/me");
    expect(result.isError).toBe(true);
    expect(useAuthStore.getState()).toMatchObject({
      status: "anonymous",
      accessToken: null,
      endedBy: { code: "SESSION_REVOKED", message: "Signed in on another device." },
    });
  });

  it("keeps the session when the refresh cannot be answered (server down)", async () => {
    mockFetch((s) =>
      s.url.endsWith("/auth/refresh")
        ? fail(500, "INTERNAL_ERROR", "Down")
        : fail(401, "SESSION_EXPIRED", "Token expired"),
    );
    const result = await run("/me");
    expect(result.isError).toBe(true);
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("does not try to refresh a rejected sign-in", async () => {
    const seen = mockFetch(() => fail(401, "INVALID_CREDENTIALS", "Wrong email or password."));
    const result = await makeStore().dispatch(
      sessionApi.endpoints.login.initiate({ email: "a@b.co", password: "x" }),
    );
    expect("error" in result).toBe(true);
    expect(seen).toHaveLength(1);
    expect(useAuthStore.getState().status).toBe("authenticated"); // untouched
  });

  it("retries 429 and 503 at most twice, honouring Retry-After", async () => {
    const seen = mockFetch((_s, count) =>
      count < 3
        ? fail(429, "RATE_LIMITED", "Slow down", { "retry-after": "0" })
        : ok({ done: true }),
    );
    const result = await run("/x");
    expect(result.data).toEqual({ data: { done: true } });
    expect(seen).toHaveLength(3);

    const always = mockFetch(() => fail(503, "INTERNAL_ERROR", "Busy", { "retry-after": "0" }));
    const failed = await run("/y");
    expect(failed.isError).toBe(true);
    expect(always).toHaveLength(3);
  });

  it("stores the token from a sign-in", async () => {
    useAuthStore.getState().clear();
    mockFetch(() => ok({ accessToken: "fresh", expiresIn: 900, user: { id: "u1" } }));
    await makeStore().dispatch(
      sessionApi.endpoints.login.initiate({ email: "a@b.co", password: "x" }),
    );
    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      accessToken: "fresh",
    });
  });
});
