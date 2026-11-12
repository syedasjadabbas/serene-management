import type { BlockStatusType, GroupStatus } from "./groups.policy";

/** Group and block views (Phase 6). */

type Ref = { id: string; code: string; name: string };
type Totals = { allocated: number; pickedUp: number; released: number; remaining: number };

export interface GroupListItem {
  id: string;
  code: string;
  name: string;
  status: GroupStatus;
  account: string | null;
  contact: string | null;
  blocks: number;
  firstNight: string | null;
  departure: string | null;
  totals: Totals;
}

export interface BlockView {
  id: string;
  code: string;
  name: string;
  version: number;
  status: { id: string; code: string; name: string; type: BlockStatusType; allowsPickup: boolean };
  startDate: string;
  endDate: string;
  cutoffDate: string | null;
  isElastic: boolean;
  ratePlan: Ref | null;
  reservationType: Ref;
  totals: Totals;
  roomTypes: {
    roomType: Ref;
    totals: Totals;
    nights: {
      date: string;
      allocated: number;
      pickedUp: number;
      released: number;
      remaining: number;
    }[];
  }[];
}

export interface GroupReservationRow {
  reservationRoomId: string;
  reservationId: string;
  confirmation: string;
  guestName: string;
  roomType: string;
  arrival: string;
  departure: string;
  rooms: number;
  status: string;
  blockCode: string | null;
}

export interface GroupDetail {
  id: string;
  code: string;
  name: string;
  status: GroupStatus;
  notes: string | null;
  account: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  createdAt: string;
  businessDate: string | null;
  blocks: BlockView[];
  reservations: GroupReservationRow[];
  actions: { manage: boolean; pickup: boolean };
}

export interface GroupOptions {
  businessDate: string | null;
  statuses: (Ref & { type: BlockStatusType; allowsPickup: boolean; isDefault: boolean })[];
  ratePlans: Ref[];
  roomTypes: Ref[];
  reservationTypes: (Ref & { deductsInventory: boolean })[];
  marketCodes: Ref[];
  sourceCodes: Ref[];
}

export interface PickupResult {
  reservationId: string;
  reservationRoomIds: string[];
  blockId: string;
}

export interface ReleaseResult {
  blockId: string;
  released: number;
  version: number;
}
