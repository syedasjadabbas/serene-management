import type { RoomTypeAvailabilityStatus } from "@/modules/availability/availability.policy";

export interface OrganizationPropertyRef {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  timezone: string;
}

/** `GET /api/v1/organization/overview`: one card per accessible property. */
export interface OrganizationOverview {
  organization: { id: string; code: string; name: string; baseCurrency: string };
  properties: {
    property: OrganizationPropertyRef;
    /** Open business date (each property has its own; null before go-live). */
    businessDate: string | null;
    /** Operational status of the business date (night audit running, not live). */
    dateStatus: "OPEN" | "IN_AUDIT" | "NOT_INITIALIZED";
    /** Night audit timing against the property clock (null before go-live). */
    auditState: string | null;
    /** Today's figures; null without dashboard:read there or before go-live. */
    today: {
      arrivalsExpected: number;
      arrivalsDone: number;
      departuresExpected: number;
      departuresDone: number;
      inHouse: number;
      roomsOccupied: number;
      roomsAvailable: number;
      occupancy: string;
    } | null;
    /** Open folio balance in the property's currency (reports:financial only). */
    openBalance: string | null;
  }[];
  access: {
    reports: boolean;
    availability: boolean;
    audit: boolean;
    users: boolean;
    manageProperties: boolean;
  };
}

export interface PerformanceFigures {
  nights: number;
  roomsAvailable: number;
  roomsSold: number;
  occupancy: string;
  arrivals: number;
  departures: number;
  noShows: number;
  cancellations: number;
  /** Money in `currencyCode`; null without reports:financial. */
  adr: string | null;
  revpar: string | null;
  roomRevenue: string | null;
  totalRevenue: string | null;
  tax: string | null;
  payments: string | null;
  refunds: string | null;
  /** Open folio balances now (not range-bound). */
  openBalance: string | null;
}

/**
 * `GET /api/v1/organization/reports/performance` (D38): per property in its
 * own currency, and per-currency subtotals. Currencies are never summed (D4).
 */
export interface OrganizationPerformanceReport {
  from: string;
  to: string;
  properties: ({
    property: OrganizationPropertyRef;
    currencyCode: string;
    businessDate: string;
    dateStatus: "OPEN" | "IN_AUDIT" | "NOT_INITIALIZED";
    coveredTo: string;
    /** The open business date is included and read live. */
    liveIncluded: boolean;
    financial: boolean;
  } & PerformanceFigures)[];
  currencies: ({
    currencyCode: string;
    propertyCount: number;
    /** Money is shown only when the caller has reports:financial at every property of the group. */
    financial: boolean;
  } & PerformanceFigures)[];
  /** Room counts and movements across all included properties (no money: D4). */
  overall: Pick<
    PerformanceFigures,
    | "nights"
    | "roomsAvailable"
    | "roomsSold"
    | "occupancy"
    | "arrivals"
    | "departures"
    | "noShows"
    | "cancellations"
  > & { propertyCount: number };
  /** Accessible properties without figures, and why. */
  excluded: { property: OrganizationPropertyRef; reason: "NOT_LIVE" | "RANGE_AFTER_OPEN_DATE" }[];
  notes: string[];
}

/** `GET /api/v1/availability` (D8): search across properties, booking handed off to one. */
export interface CentralAvailabilityResult {
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  rooms: number;
  properties: {
    property: OrganizationPropertyRef;
    businessDate: string | null;
    status: "AVAILABLE" | "UNAVAILABLE" | "NOT_LIVE" | "ARRIVAL_IN_PAST";
    message: string | null;
    roomTypes: {
      id: string;
      code: string;
      name: string;
      status: RoomTypeAvailabilityStatus;
      available: number;
      /** Lowest bookable total in the property's currency, if any. */
      lowestTotal: string | null;
      bookableRates: number;
    }[];
    /** The caller may start a booking there (hand-off target). */
    canBook: boolean;
  }[];
  notes: string[];
}
