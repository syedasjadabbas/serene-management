import type { BookingState, ReservationStatus } from "./reservations.policy";

interface CodeRef {
  id: string;
  code: string;
  name: string;
}

/** One row of the reservation search (a reservation room: the operational unit). */
export interface ReservationListItem {
  reservationId: string;
  reservationRoomId: string;
  confirmationNumber: string;
  displayConfirmation: string;
  lineNumber: number;
  status: ReservationStatus;
  bookingState: BookingState;
  guest: { id: string; name: string; isVip: boolean };
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  roomType: { code: string; name: string };
  room: { number: string } | null;
  ratePlan: { code: string };
  source: { code: string };
  channel: { code: string } | null;
  currencyCode: string;
  totalAmount: string;
  bookedAt: string;
}

export interface ReservationAllowedActions {
  modify: boolean;
  confirm: boolean;
  cancel: boolean;
  noShow: boolean;
  reinstate: boolean;
  assignRoom: boolean;
  /** Front desk (Phase 3). */
  checkIn: boolean;
  checkOut: boolean;
  moveRoom: boolean;
  /** Book or remove packages on future nights (Phase 6). */
  managePackages: boolean;
}

export interface ReservationRoomDetail {
  id: string;
  lineNumber: number;
  displayConfirmation: string;
  version: number;
  status: ReservationStatus;
  bookingState: BookingState;
  primaryGuest: {
    id: string;
    name: string;
    profileNumber: string;
    email: string | null;
    phone: string | null;
  };
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  eta: string | null;
  roomType: CodeRef;
  room: { id: string; number: string } | null;
  ratePlan: CodeRef;
  reservationType: CodeRef & { deductsInventory: boolean; isGuaranteed: boolean };
  marketCode: CodeRef;
  sourceCode: CodeRef;
  cancellationPolicy: (CodeRef & { description: string | null }) | null;
  currencyCode: string;
  totalAmount: string;
  nightly: { date: string; amount: string; roomTypeCode: string; ratePlanCode: string }[];
  cancellation: { number: string; at: string; reason: CodeRef | null } | null;
  noShowAt: string | null;
  /** The operational stay once checked in. */
  stay: { id: string; status: string; checkedInAt: string; checkedOutAt: string | null } | null;
  /** Group block the room was picked up from (Phase 6). */
  group: { id: string; code: string; name: string; blockId: string; blockCode: string } | null;
  /** Packages booked on the room in addition to its rate plan's packages. */
  packages: {
    id: string;
    code: string;
    name: string;
    postingType: string;
    quantity: number;
    startDate: string;
    endDate: string;
  }[];
  allowedActions: ReservationAllowedActions;
}

export interface ReservationHistoryEntry {
  id: string;
  at: string;
  action: string;
  userDisplayName: string | null;
  risk: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

export interface ReservationDetail {
  id: string;
  confirmationNumber: string;
  bookedAt: string;
  bookedBy: string | null;
  channel: CodeRef | null;
  externalReference: string | null;
  businessDate: string | null;
  rooms: ReservationRoomDetail[];
  notes: { id: string; body: string; createdAt: string }[];
  history: ReservationHistoryEntry[];
}

export interface BookingOptions {
  roomTypes: (CodeRef & { maxOccupancy: number; maxAdults: number; maxChildren: number })[];
  ratePlans: (CodeRef & {
    defaultMarketCodeId: string | null;
    defaultSourceCodeId: string | null;
  })[];
  reservationTypes: (CodeRef & { deductsInventory: boolean; isGuaranteed: boolean })[];
  marketCodes: CodeRef[];
  sourceCodes: CodeRef[];
  channels: CodeRef[];
  reasonCodes: { cancellation: CodeRef[]; noShow: CodeRef[] };
}

export interface AvailableRoomView {
  id: string;
  number: string;
  floor: string | null;
  housekeepingStatus: string;
  frontOfficeStatus: string;
  /** An out-of-service block overlaps the requested nights (usable only with an override). */
  outOfService: boolean;
  isAccessible: boolean;
  isSmoking: boolean;
}
