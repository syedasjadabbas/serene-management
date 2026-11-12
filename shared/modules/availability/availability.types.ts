import type { RestrictionViolation, RoomTypeAvailabilityStatus } from "./availability.policy";

export interface NightAvailabilityView {
  date: string;
  physical: number;
  outOfOrder: number;
  sold: number;
  tentative: number;
  available: number;
}

export interface RateQuoteView {
  ratePlan: { id: string; code: string; name: string; kind: string };
  currencyCode: string;
  taxInclusive: boolean;
  /** Decimal strings in the currency's minor units. */
  total: string | null;
  averageNightly: string | null;
  nightly: { date: string; amount: string | null }[];
  bookable: boolean;
  unavailableReason: "RESTRICTED" | "NOT_PRICED" | null;
  restrictions: RestrictionViolation[];
  cancellationPolicy: { id: string; code: string; name: string; description: string | null } | null;
}

export interface RoomTypeAvailabilityView {
  roomType: {
    id: string;
    code: string;
    name: string;
    maxOccupancy: number;
    maxAdults: number;
    maxChildren: number;
  };
  status: RoomTypeAvailabilityStatus;
  occupancyProblems: string[];
  /** Tightest night of the stay. */
  physical: number;
  reserved: number;
  tentative: number;
  outOfOrder: number;
  available: number;
  requestedRooms: number;
  restrictions: RestrictionViolation[];
  nights: NightAvailabilityView[];
  rates: RateQuoteView[];
}

export interface AvailabilityView {
  propertyId: string;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  rooms: number;
  businessDate: string;
  roomTypes: RoomTypeAvailabilityView[];
}
