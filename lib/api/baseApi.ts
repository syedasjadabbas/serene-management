import {
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
  createApi,
  fetchBaseQuery,
} from "@reduxjs/toolkit/query/react";

/**
 * The single RTK Query API. Domains add endpoints with
 * `baseApi.injectEndpoints` (route-local `lib/*.api.ts`, or
 * `lib/api/endpoints/` once a second route needs them).
 *
 * Auth uses httpOnly cookies, so requests only need `credentials: "include"`.
 * The active property travels in the URL path (/api/v1/properties/:id/...),
 * which also makes it part of every cache key.
 */
export const TAG_TYPES = [
  "Me",
  "Property",
  "BusinessDate",
  "PropertyConfiguration",
  "AuditLog",
  "Session",
  "Room",
  "RoomStatus",
  "RoomType",
  "Availability",
  "RatePlan",
  "Guest",
  "Account",
  "Reservation",
  "Stay",
  "Folio",
  "Payment",
  "CashierShift",
  "HousekeepingTask",
  "MaintenanceRequest",
  "Group",
  "Block",
  "NightAudit",
  "Report",
  "User",
  "Role",
] as const;

const rawBaseQuery = fetchBaseQuery({ baseUrl: "/api/v1", credentials: "include" });

/** One refresh at a time: concurrent 401s wait for the same attempt. */
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

function isAuthEndpoint(args: string | FetchArgs): boolean {
  const url = typeof args === "string" ? args : args.url;
  return (
    url.startsWith("/auth/login") ||
    url.startsWith("/auth/refresh") ||
    url.startsWith("/auth/logout")
  );
}

/**
 * On 401, refresh the session once and retry. If refresh fails, send the user
 * to the login page, preserving where they were.
 */
const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  let result = await rawBaseQuery(args, api, extraOptions);
  if (result.error?.status !== 401 || isAuthEndpoint(args)) return result;

  if (await refreshSession()) {
    result = await rawBaseQuery(args, api, extraOptions);
  } else if (typeof window !== "undefined") {
    const next = `${window.location.pathname}${window.location.search}`;
    // Deliberate full navigation (not the router): the session is gone, so
    // all in-memory client state must be discarded with the page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
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
