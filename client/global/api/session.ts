import { API_BASE_URL, CLIENT_PLATFORM, CLIENT_PLATFORM_HEADER } from "@/global/constants/api";
import { type SessionEnd, getAccessToken, useAuthStore } from "@/global/stores/auth.store";

/**
 * Token lifecycle outside React: the boot refresh, the single in-flight
 * refresh shared by the base query, the live-update stream and downloads,
 * and the authenticated `fetch` used where RTK Query cannot send headers
 * (SSE, avatar image, CSV export, offline session check).
 */

export type RefreshOutcome =
  | { kind: "ok" }
  /** The server refused the refresh cookie: the session is over. */
  | { kind: "denied"; end: SessionEnd }
  /** No usable answer (network down, server error): the session may still be fine. */
  | { kind: "unavailable" };

interface RefreshBody {
  success?: boolean;
  message?: string;
  data?: { accessToken?: string; expiresIn?: number };
  error?: { code?: string };
}

/** `fetch`, narrowed to what this module needs (tests pass a stub). */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

let refreshInFlight: Promise<RefreshOutcome> | null = null;

async function requestRefresh(fetcher: Fetcher): Promise<RefreshOutcome> {
  try {
    const response = await fetcher(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { [CLIENT_PLATFORM_HEADER]: CLIENT_PLATFORM, Accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as RefreshBody | null;
    const data = body?.data;
    if (response.ok && typeof data?.accessToken === "string") {
      useAuthStore.getState().setSession(data.accessToken, Number(data.expiresIn ?? 0));
      return { kind: "ok" };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        kind: "denied",
        end: {
          code: body?.error?.code ?? "UNAUTHENTICATED",
          message: body?.message || "Your session has ended. Sign in again to continue.",
        },
      };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** One refresh at a time: concurrent callers wait for the same attempt. */
export function refreshAccessToken(fetcher: Fetcher = fetch): Promise<RefreshOutcome> {
  refreshInFlight ??= requestRefresh(fetcher).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

let bootStarted = false;

/** App boot: one refresh with the cookie decides authenticated or anonymous. */
export async function bootAuth(fetcher: Fetcher = fetch): Promise<void> {
  if (bootStarted) return;
  bootStarted = true;
  const outcome = await refreshAccessToken(fetcher);
  if (outcome.kind !== "ok") useAuthStore.getState().clear();
}

/** For tests: lets `bootAuth` run again. */
export function resetBootForTests(): void {
  bootStarted = false;
  refreshInFlight = null;
}

export function authHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set(CLIENT_PLATFORM_HEADER, CLIENT_PLATFORM);
  return headers;
}

/**
 * `fetch` against the API with the Bearer header; on 401 refreshes once and
 * retries. `path` is relative to the API base (e.g. `/me/avatar`) or an
 * absolute URL under it. Does not redirect: callers decide what a failure means.
 */
export async function authorizedFetch(
  path: string,
  init: RequestInit = {},
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const url = /^https?:\/\//.test(path) ? path : `${API_BASE_URL}${path}`;
  const send = () =>
    fetcher(url, { ...init, credentials: "include", headers: authHeaders(init.headers) });
  const response = await send();
  if (response.status !== 401) return response;
  const outcome = await refreshAccessToken(fetcher);
  if (outcome.kind === "ok") return send();
  if (outcome.kind === "denied") useAuthStore.getState().clear(outcome.end);
  return response;
}
