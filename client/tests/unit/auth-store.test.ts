import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootAuth, refreshAccessToken, resetBootForTests } from "@/global/api/session";
import { API_BASE_URL } from "@/global/constants/api";
import { useAuthStore } from "@/global/stores/auth.store";

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

function stubFetch(...responses: (Response | Error)[]) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
}

beforeEach(() => {
  resetBootForTests();
  useAuthStore.setState(useAuthStore.getInitialState(), true);
});
afterEach(() => vi.useRealTimers());

describe("auth store", () => {
  it("starts booting with no token", () => {
    expect(useAuthStore.getState()).toMatchObject({
      status: "booting",
      accessToken: null,
      expiresAt: null,
    });
  });

  it("setSession stores the token and an absolute expiry, and clears any end reason", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useAuthStore.getState().clear({ code: "SESSION_REVOKED", message: "x" });
    useAuthStore.getState().setSession("abc", 900);
    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      accessToken: "abc",
      expiresAt: 1_000_000 + 900_000,
      endedBy: null,
    });
  });

  it("clear drops the token and records why (or that the user chose to sign out)", () => {
    useAuthStore.getState().setSession("abc", 900);
    useAuthStore.getState().clear({ code: "SESSION_REVOKED", message: "Signed out elsewhere." });
    expect(useAuthStore.getState()).toMatchObject({
      status: "anonymous",
      accessToken: null,
      endedBy: { code: "SESSION_REVOKED", message: "Signed out elsewhere." },
      deliberate: false,
    });
    useAuthStore.getState().clear(null, { deliberate: true });
    expect(useAuthStore.getState().deliberate).toBe(true);
  });
});

describe("boot refresh", () => {
  it("authenticates from the refresh cookie: one POST with credentials and the platform header", async () => {
    const fetcher = stubFetch(
      reply(200, { success: true, message: "OK", data: { accessToken: "t1", expiresIn: 900 } }),
    );
    await bootAuth(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${API_BASE_URL}/auth/refresh`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(new Headers(init?.headers).get("x-client-platform")).toBe("web");
    expect(useAuthStore.getState()).toMatchObject({ status: "authenticated", accessToken: "t1" });
  });

  it("is anonymous when there is no valid cookie", async () => {
    await bootAuth(
      stubFetch(
        reply(401, { success: false, message: "No session", error: { code: "UNAUTHENTICATED" } }),
      ),
    );
    expect(useAuthStore.getState()).toMatchObject({ status: "anonymous", accessToken: null });
  });

  it("is anonymous when the server cannot be reached", async () => {
    await bootAuth(stubFetch(new TypeError("fetch failed")));
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("runs once, even if called again (React strict mode)", async () => {
    const fetcher = stubFetch(
      reply(200, { success: true, data: { accessToken: "t1", expiresIn: 900 } }),
    );
    await Promise.all([bootAuth(fetcher), bootAuth(fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    const fetcher = stubFetch(
      reply(200, { success: true, data: { accessToken: "t2", expiresIn: 900 } }),
    );
    const [a, b] = await Promise.all([refreshAccessToken(fetcher), refreshAccessToken(fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ kind: "ok" });
    expect(b).toEqual({ kind: "ok" });
  });

  it("reports the server's reason when the refresh is denied", async () => {
    const outcome = await refreshAccessToken(
      stubFetch(
        reply(401, {
          success: false,
          message: "This session was revoked.",
          error: { code: "SESSION_REVOKED" },
        }),
      ),
    );
    expect(outcome).toEqual({
      kind: "denied",
      end: { code: "SESSION_REVOKED", message: "This session was revoked." },
    });
  });
});
