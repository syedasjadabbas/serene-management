import type { Permission } from "@/lib/permissions/catalog";
import type { SearchHitView, SearchResultType } from "./search.types";

/** Pure global-search rules, shared by the server and the palette (docs/SCALABILITY.md §28). */

/** Result groups in this order: today's work first, reference data last. */
export const SEARCH_RESULT_TYPES: readonly SearchResultType[] = [
  "reservations",
  "guests",
  "rooms",
  "folios",
  "companies",
  "groups",
  "maintenance",
  "ratePlans",
];

/** Results per type (unchanged from the former per-source requests). */
export const SEARCH_LIMIT_PER_TYPE = 5;
/** At most one full page of every type. */
export const SEARCH_LIMIT_TOTAL = SEARCH_LIMIT_PER_TYPE * SEARCH_RESULT_TYPES.length;
export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 100;

/** The parts of the signed-in user's session the target resolver needs (MeView or session). */
export interface SearchScope {
  user: { isSuperAdmin: boolean };
  /** Properties the user can access, with their effective permissions (organization grants included). */
  properties: { code: string; permissions: readonly string[] }[];
}

/**
 * The property an organization-level record (guest, company) opens in from
 * global search: only a property the user can access AND where they hold
 * the permission the record page needs there. When several qualify, the
 * lowest property code (a stable, deterministic choice). Null when none
 * does: the result is then shown as unavailable, never linked.
 */
export function profileTargetCode(scope: SearchScope, permission: Permission): string | null {
  const permitted = scope.properties
    .filter((p) => scope.user.isSuperAdmin || p.permissions.includes(permission))
    .map((p) => p.code)
    .sort();
  return permitted[0] ?? null;
}

const PROPERTY_CODE = /^[A-Za-z0-9_-]{1,20}$/;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The page a result opens, built from its type (never taken from the
 * response): null when the result has no property to open in or its codes
 * are not well formed. The palette additionally requires the property to be
 * one of the user's.
 */
export function searchResultRoute(
  hit: Pick<SearchHitView, "type" | "propertyCode" | "targetId" | "roomView">,
): string | null {
  const code = hit.propertyCode;
  if (!code || !PROPERTY_CODE.test(code) || !RECORD_ID.test(hit.targetId)) return null;
  const id = hit.targetId;
  switch (hit.type) {
    case "reservations":
      return `/${code}/reservations/${id}`;
    case "guests":
      return `/${code}/guests/${id}`;
    case "folios":
      return `/${code}/billing/${id}`;
    case "companies":
      return `/${code}/companies/${id}`;
    case "groups":
      return `/${code}/groups/${id}`;
    case "maintenance":
      return `/${code}/maintenance/${id}`;
    case "ratePlans":
      return `/${code}/rates/${id}`;
    case "rooms":
      return hit.roomView === "housekeeping"
        ? `/${code}/housekeeping?room=${id}`
        : hit.roomView === "front-desk"
          ? `/${code}/front-desk?view=rooms&room=${id}`
          : null;
    default:
      return null;
  }
}

/**
 * True when a response belongs to the search on screen: responses of
 * earlier keystrokes (or another property) must never replace newer results.
 */
export function isCurrentSearch(
  response: { query: string } | undefined,
  args: { q: string; propertyId: string | null } | undefined,
  current: { q: string; propertyId: string | null },
): boolean {
  return Boolean(
    response &&
    args &&
    args.q === current.q &&
    args.propertyId === current.propertyId &&
    response.query === current.q,
  );
}
