import {
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
  type FetchBaseQueryMeta,
  createApi,
  fetchBaseQuery,
} from "@reduxjs/toolkit/query/react";
import {
  API,
  API_BASE_URL,
  CLIENT_PLATFORM,
  CLIENT_PLATFORM_HEADER,
  TAG_TYPES,
} from "@/global/constants/api";
import { type SessionEnd, getAccessToken, useAuthStore } from "@/global/stores/auth.store";
import { refreshAccessToken } from "./session";

export { TAG_TYPES };

/**
 * The single RTK Query API. Domains add endpoints with
 * `baseApi.injectEndpoints` (`global/api/endpoints/<feature>Api.ts`).
 *
 * Requests go to the Express server (`API_BASE_URL`) with
 * `Authorization: Bearer <access token>` from the auth store and
 * `X-Client-Platform: web`; the refresh-token cookie travels via
 * `credentials: "include"`. The active property is in the URL path
 * (/properties/:id/...), which also makes it part of every cache key.
 *
 * Responses use the server envelope. Success `{ success, message, data, meta? }`
 * is reduced to `{ data, meta? }`, the shape endpoint `transformResponse`
 * functions read. Failures keep the body in `error.data`
 * (`{ success: false, message, error: { code, details?, requestId } }`);
 * `toClientApiError` (errors.ts) maps it for display.
 */

/** Reduces the success envelope to `{ data, meta? }`; other bodies pass through. */
export function unwrapEnvelope(body: unknown): unknown {
  if (body && typeof body === "object" && (body as { success?: unknown }).success === true) {
    const { data, meta } = body as { data?: unknown; meta?: unknown };
    return meta === undefined ? { data } : { data, meta };
  }
  return body;
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  credentials: "include",
  prepareHeaders: (headers) => {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    headers.set(CLIENT_PLATFORM_HEADER, CLIENT_PLATFORM);
    return headers;
  },
});

/** Re-exported for the live-update stream: refreshes the token (single flight). */
export async function refreshSession(): Promise<boolean> {
  return (await refreshAccessToken()).kind === "ok";
}

const NO_REAUTH = [
  API.auth.authLogin(),
  API.auth.refresh(),
  API.auth.authLogout(),
  API.auth.authPasswordReset(),
];

function isAuthEndpoint(args: string | FetchArgs): boolean {
  const url = typeof args === "string" ? args : args.url;
  return NO_REAUTH.some((prefix) => url.startsWith(prefix));
}

/** The reason a 401 body gives for the session ending, if it has one. */
function endOf(body: unknown): SessionEnd | null {
  const b = body as { message?: unknown; error?: { code?: unknown } } | null | undefined;
  const code = b?.error?.code;
  if (typeof code === "string" && typeof b?.message === "string" && code !== "UNAUTHENTICATED") {
    return { code, message: b.message };
  }
  return null;
}

export const MAX_RETRIES = 2;
const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 10_000;

/** Wait before retry `attempt` (0-based): `Retry-After` (seconds or date) or exponential backoff. */
export function retryDelayMs(attempt: number, retryAfter: string | null, now = Date.now()): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(ms)) return Math.min(Math.max(ms, 0), RETRY_MAX_MS);
  }
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

type Result = Awaited<ReturnType<typeof rawBaseQuery>>;

/** Retries throttled (429) and unavailable (503) answers, at most MAX_RETRIES times. */
async function sendWithRetry(
  args: string | FetchArgs,
  api: Parameters<typeof rawBaseQuery>[1],
  extraOptions: Parameters<typeof rawBaseQuery>[2],
): Promise<Result> {
  let result = await rawBaseQuery(args, api, extraOptions);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const status = result.error?.status;
    if ((status !== 429 && status !== 503) || api.signal.aborted) break;
    const meta = result.meta as FetchBaseQueryMeta | undefined;
    await sleep(
      retryDelayMs(attempt, meta?.response?.headers.get("retry-after") ?? null),
      api.signal,
    );
    if (api.signal.aborted) break;
    result = await rawBaseQuery(args, api, extraOptions);
  }
  return result;
}

/**
 * Unwraps the envelope; on 401 refreshes the token once (one refresh at a
 * time across all requests) and retries. When the server refuses the refresh
 * the auth store becomes anonymous with the server's reason, and the
 * workspace guard sends the user to /login?next=…&reason=<code>.
 */
export const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError,
  object,
  FetchBaseQueryMeta
> = async (args, api, extraOptions) => {
  const sentWith = getAccessToken();
  let result = await sendWithRetry(args, api, extraOptions);

  if (
    result.error?.status === 401 &&
    !isAuthEndpoint(args) &&
    useAuthStore.getState().status !== "anonymous"
  ) {
    const current = getAccessToken();
    let renewed = current !== null && current !== sentWith; // another request already refreshed
    let end: SessionEnd | null = null;
    if (!renewed) {
      const outcome = await refreshAccessToken();
      renewed = outcome.kind === "ok";
      if (outcome.kind === "denied") end = endOf(result.error.data) ?? outcome.end;
    }
    if (renewed) {
      result = await sendWithRetry(args, api, extraOptions);
    } else if (end) {
      useAuthStore.getState().clear(end);
    }
  }

  if (result.data !== undefined) return { ...result, data: unwrapEnvelope(result.data) };
  return result;
};

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithReauth,
  tagTypes: TAG_TYPES,
  // Operational data changes constantly; prefer short-lived caches plus
  // explicit invalidation and real-time events over long cache lifetimes.
  keepUnusedDataFor: 30,
  refetchOnReconnect: true,
  endpoints: () => ({}),
});
