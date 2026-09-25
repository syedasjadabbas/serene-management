import type { FolioSummary } from "@/modules/billing/billing.types";
import type { RoomBoardStatus, RoomReadiness } from "@/modules/rooms/rooms.policy";
import type { ArrivalState, CheckoutTiming } from "./front-desk.policy";

/** Front desk contracts (docs/API_CONVENTIONS.md, Phase 3). */

export interface CodeRef {
  id: string;
  code: string;
  name: string;
}

export interface FrontDeskGuest {
  id: string;
  name: string;
  /** VIP level code from the guest profile, if any. */
  vip: string | null;
}

export interface FrontDeskRoom {
  id: string;
  number: string;
  housekeepingStatus: string;
  frontOfficeStatus: string;
  readiness: RoomReadiness;
}

export interface FrontDeskSummary {
  businessDate: string;
  arrivals: { total: number; pending: number; unassigned: number; checkedIn: number };
  inHouse: { total: number; arrivedToday: number; dueOut: number };
  departures: { dueOut: number; departed: number };
  rooms: Record<RoomBoardStatus, number> & { total: number };
}

export interface ArrivalRow {
  reservationRoomId: string;
  reservationId: string;
  confirmation: string;
  version: number;
  status: string;
  state: ArrivalState;
  guest: FrontDeskGuest;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  eta: string | null;
  roomType: CodeRef;
  room: FrontDeskRoom | null;
  reservationType: { code: string; deductsInventory: boolean };
  isWalkIn: boolean;
  latestNote: string | null;
  stayId: string | null;
}

export interface StayRow {
  stayId: string;
  stayStatus: "IN_HOUSE" | "CHECKED_OUT";
  version: number;
  reservationRoomId: string;
  reservationId: string;
  confirmation: string;
  guest: FrontDeskGuest;
  room: { id: string; number: string; housekeepingStatus: string; frontOfficeStatus: string };
  roomType: CodeRef;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  checkedInAt: string;
  checkedOutAt: string | null;
  departureBusinessDate: string | null;
  /** For in-house stays: how a check-out today would be classified. */
  checkoutTiming: CheckoutTiming | null;
  latestNote: string | null;
}

export interface RoomOption {
  id: string;
  number: string;
  floor: string | null;
  housekeepingStatus: string;
  frontOfficeStatus: string;
  readiness: RoomReadiness;
  isAccessible: boolean;
  isSmoking: boolean;
}

export interface StayAssignmentEntry {
  id: string;
  roomNumber: string;
  from: string;
  to: string;
  kind: string;
  status: string;
  reason: CodeRef | null;
  assignedAt: string;
  assignedBy: string | null;
  releasedAt: string | null;
}

export interface StayHistoryEntry {
  id: string;
  at: string;
  action: string;
  userDisplayName: string | null;
  risk: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

export interface StayDetail {
  id: string;
  status: "IN_HOUSE" | "CHECKED_OUT";
  version: number;
  businessDate: string | null;
  reservationId: string;
  reservationRoomId: string;
  confirmation: string;
  guest: FrontDeskGuest & {
    profileNumber: string;
    email: string | null;
    phone: string | null;
  };
  room: { id: string; number: string; housekeepingStatus: string; frontOfficeStatus: string };
  roomType: CodeRef;
  ratePlan: CodeRef;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  isWalkIn: boolean;
  checkedInAt: string;
  checkedInBy: string | null;
  arrivalBusinessDate: string;
  checkedOutAt: string | null;
  checkedOutBy: string | null;
  departureBusinessDate: string | null;
  checkoutTiming: CheckoutTiming | null;
  notes: { id: string; body: string; createdAt: string }[];
  assignments: StayAssignmentEntry[];
  roomStatusChanges: {
    id: string;
    roomNumber: string;
    field: string;
    from: string | null;
    to: string | null;
    source: string;
    at: string;
    by: string | null;
  }[];
  history: StayHistoryEntry[];
  /** Ledger balance of the stay's billing windows (null before a folio is opened). */
  folio: FolioSummary | null;
  allowedActions: { checkOut: boolean; moveRoom: boolean; viewFolio: boolean; extend: boolean };
  /** Operational reason codes for the dialogs. */
  reasonCodes: { roomMove: CodeRef[]; earlyDeparture: CodeRef[] };
}

export interface CheckInResult {
  stayId: string;
  reservationId: string;
  roomNumber: string;
}
