import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

/**
 * The single RTK Query API. Domains add endpoints with
 * `baseApi.injectEndpoints` in their route folder
 * (e.g. app/(workspace)/reservations/lib/reservations.api.ts).
 *
 * Auth uses httpOnly cookies, so requests only need `credentials: "include"`.
 * The active property travels in the URL path (/api/v1/properties/:id/...),
 * which also makes it part of every cache key.
 */
export const TAG_TYPES = [
  "Me",
  "Property",
  "BusinessDate",
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

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: "/api/v1",
    credentials: "include",
  }),
  tagTypes: TAG_TYPES,
  // Operational data changes constantly; prefer short-lived caches plus
  // explicit invalidation and real-time events over long cache lifetimes.
  keepUnusedDataFor: 30,
  refetchOnReconnect: true,
  endpoints: () => ({}),
});
