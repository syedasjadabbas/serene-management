import type { RoomBoardStatus, RoomReadiness } from "./rooms.policy";

/** Room contracts (docs/API_CONVENTIONS.md, Phases 3–4). */

export interface RoomBoardRow {
  id: string;
  number: string;
  version: number;
  floor: { id: string; name: string } | null;
  roomType: { id: string; code: string };
  housekeepingStatus: string;
  frontOfficeStatus: string;
  /** Out-of-order / out-of-service block covering the business date. */
  block: {
    id: string;
    kind: "OUT_OF_ORDER" | "OUT_OF_SERVICE";
    until: string;
    reason: string | null;
  } | null;
  status: RoomBoardStatus;
  readiness: RoomReadiness;
  /** Guest details are null for users without frontdesk:read. */
  inHouse: {
    stayId: string | null;
    guestName: string | null;
    vip: string | null;
    departure: string | null;
    departingToday: boolean;
  } | null;
  arriving: {
    reservationId: string | null;
    reservationRoomId: string | null;
    guestName: string | null;
    vip: string | null;
    eta: string | null;
  } | null;
  task: {
    id: string;
    status: string;
    priority: number;
    typeCode: string;
    attendant: string | null;
  } | null;
  maintenance: { open: number; topPriority: "URGENT" | "HIGH" | "NORMAL" | "LOW" } | null;
  urgency: "URGENT" | "PRIORITY" | "NORMAL";
}

export interface RoomBoardView {
  businessDate: string;
  counts: Record<RoomBoardStatus, number> & {
    total: number;
    dirty: number;
    clean: number;
    inspected: number;
    urgent: number;
    maintenance: number;
  };
  items: RoomBoardRow[];
}

export interface RoomDetail {
  id: string;
  number: string;
  version: number;
  description: string | null;
  active: boolean;
  roomType: { id: string; code: string; name: string };
  floor: { id: string; name: string } | null;
  housekeepingStatus: string;
  frontOfficeStatus: string;
  serviceStatus: string;
  readiness: RoomReadiness;
  requireInspected: boolean;
  isAccessible: boolean;
  isSmoking: boolean;
  blocks: {
    id: string;
    kind: string;
    status: string;
    from: string;
    to: string;
    notes: string | null;
    reason: { id: string; code: string; name: string };
    maintenanceRequestId: string | null;
    coversBusinessDate: boolean;
  }[];
  history: {
    id: string;
    roomNumber: string;
    field: string;
    from: string | null;
    to: string | null;
    businessDate: string;
    source: string;
    reason: string | null;
    changedById: string | null;
    at: string;
  }[];
}
