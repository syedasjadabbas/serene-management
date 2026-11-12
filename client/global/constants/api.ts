import { ALL_PERMISSIONS, type Permission } from "@serene/shared/lib/permissions/catalog";

/**
 * API base URL (the Express server). `NEXT_PUBLIC_API_URL` is inlined at build
 * time; the default targets the local development server.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:4000/api/v1"
).replace(/\/+$/, "");

/** Origin of the API server (CSP `connect-src`, health probe). */
export const API_ORIGIN = new URL(API_BASE_URL).origin;

/** Header telling the server which client platform a session belongs to. */
export const CLIENT_PLATFORM_HEADER = "X-Client-Platform";
export const CLIENT_PLATFORM = "web";

/** RTK Query cache tag types (one place, used by `baseApi`). */
export const TAG_TYPES = [
  "Me",
  "Property",
  "BusinessDate",
  "PropertyConfiguration",
  "PropertySetup",
  "Options",
  "AuditLog",
  "Session",
  "Room",
  "RoomStatus",
  "RoomType",
  "Availability",
  "RatePlan",
  "Guest",
  "Account",
  "Loyalty",
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

type Upper<S extends string> = Uppercase<S>;
type Flat<S extends string> = S extends `${infer A}:${infer B}`
  ? `${Upper<A>}_${Flat<B>}`
  : Upper<S>;

/**
 * Permission keys as constants, generated from the shared catalog so a typo
 * is a compile error: `P.RESERVATIONS_CANCEL === "reservations:cancel"`.
 * UI gating only; the server decides.
 */
export const P = Object.fromEntries(
  ALL_PERMISSIONS.map((key) => [key.replace(/:/g, "_").toUpperCase(), key]),
) as { readonly [K in Permission as Flat<K>]: K };
