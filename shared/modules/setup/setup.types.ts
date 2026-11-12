/** Property setup views (modules/setup). Amounts and rates are decimal strings. */

export type RecordStatusView = "ACTIVE" | "INACTIVE";

export interface SetupRoomTypeView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  maxOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  defaultOccupancy: number;
  sortOrder: number;
  status: RecordStatusView;
  /** Active rooms of this type (what is sold). */
  activeRooms: number;
}

export interface SetupFloorView {
  id: string;
  code: string;
  name: string;
  level: number;
  sortOrder: number;
  status: RecordStatusView;
  activeRooms: number;
}

export interface SetupRoomView {
  id: string;
  number: string;
  roomTypeId: string;
  roomTypeCode: string;
  floorId: string | null;
  floorName: string | null;
  description: string | null;
  isSmoking: boolean;
  isAccessible: boolean;
  status: RecordStatusView;
  housekeepingStatus: string;
  frontOfficeStatus: string;
  version: number;
}

export interface SetupTaxView {
  id: string;
  code: string;
  name: string;
  calculation: "PERCENT" | "FLAT_PER_UNIT";
  basis: "NET" | "COMPOUND";
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: RecordStatusView;
  appliesTo: { id: string; code: string; name: string }[];
}

export interface SetupRevenueCodeView {
  id: string;
  code: string;
  name: string;
  groupName: string;
}

/** What a property still needs before it can sell rooms (shown as a checklist). */
export interface SetupReadiness {
  roomTypes: number;
  rooms: number;
  taxes: number;
  ratePlans: number;
  /** The property has opened its first business date. */
  live: boolean;
  businessDate: string | null;
}

export interface PropertySetupView {
  roomTypes: SetupRoomTypeView[];
  floors: SetupFloorView[];
  rooms: SetupRoomView[];
  taxes: SetupTaxView[];
  revenueCodes: SetupRevenueCodeView[];
  readiness: SetupReadiness;
}
