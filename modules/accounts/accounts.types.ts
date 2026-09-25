import type { ResourceHistoryEntry } from "@/modules/audit/audit.service";

type Ref = { id: string; code: string; name: string };

export interface AccountListItem {
  id: string;
  type: string;
  code: string | null;
  name: string;
  city: string | null;
  countryCode: string | null;
  status: string;
  isRestricted: boolean;
  contacts: number;
}

export interface AccountListPage {
  items: AccountListItem[];
  nextCursor: string | null;
}

export interface AccountContactView {
  guest: { id: string; profileNumber: string; fullName: string; email: string | null };
  kind: "EMPLOYEE" | "CONTACT" | "ASSOCIATE";
  role: string | null;
  isPrimary: boolean;
}

export interface AccountReservationRow {
  reservationId: string;
  property: { id: string; code: string };
  confirmation: string;
  guestName: string;
  arrival: string;
  departure: string;
  status: string;
  ratePlan: string;
}

export interface AccountDetail {
  id: string;
  version: number;
  type: string;
  code: string | null;
  name: string;
  legalName: string | null;
  iataNumber: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE" | "MERGED" | "ANONYMIZED";
  isRestricted: boolean;
  restrictionReason: string | null;
  /** Null without guests:read (contact persons are guest profiles). */
  contacts: AccountContactView[] | null;
  /** Recent reservations at properties where the caller holds reservations:read. */
  reservations: AccountReservationRow[];
  /** Negotiated rate plans at properties where the caller holds rates:read. */
  negotiatedRates: {
    property: { id: string; code: string };
    ratePlan: Ref;
    validFrom: string | null;
    validTo: string | null;
  }[];
  history: ResourceHistoryEntry[] | null;
  createdAt: string;
  actions: { manage: boolean };
}

/** Compact option for pickers (reservation company, contact). */
export interface AccountOption {
  id: string;
  type: string;
  code: string | null;
  name: string;
  isRestricted: boolean;
}
