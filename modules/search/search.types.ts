/** Global search contracts (scalability phase 2, docs/SCALABILITY.md §28). */

/** Result types, in the order the palette shows them. */
export type SearchResultType =
  | "reservations"
  | "guests"
  | "rooms"
  | "folios"
  | "companies"
  | "groups"
  | "maintenance"
  | "ratePlans";

/** Where a room result opens: the housekeeping board or the front desk's room view. */
export type RoomView = "housekeeping" | "front-desk";

/**
 * One result. The server never sends a URL: the client builds the route from
 * the type, the property code and the target id (search.policy
 * `searchResultRoute`) and only if that property is one the user may open.
 */
export interface SearchHitView {
  type: SearchResultType;
  /** Stable id of the row (reservation room for reservations and folios). */
  id: string;
  title: string;
  subtitle: string;
  meta: string | null;
  vip: boolean;
  /** Property the record opens in; null when the user may open it nowhere (shown unavailable). */
  propertyCode: string | null;
  /** Record the route opens: the reservation for reservation results, otherwise `id`. */
  targetId: string;
  /** Room results only. */
  roomView?: RoomView;
}

export interface SearchResultGroup {
  type: SearchResultType;
  hits: SearchHitView[];
}

export interface GlobalSearchResult {
  query: string;
  /** Non-empty groups in `SEARCH_RESULT_TYPES` order; a type the user may not search is absent. */
  groups: SearchResultGroup[];
}
