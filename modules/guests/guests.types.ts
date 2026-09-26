import type { ResourceHistoryEntry } from "@/modules/audit/audit.service";

export interface GuestSummaryView {
  id: string;
  profileNumber: string;
  title: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  nationalityCode: string | null;
  vip: { code: string; name: string } | null;
  isRestricted: boolean;
}

/** One page of the guest workspace list or search. */
export interface GuestListPage {
  items: GuestSummaryView[];
  nextCursor: string | null;
}

type Ref = { id: string; code: string; name: string };

export interface GuestContactView {
  id: string;
  type: "EMAIL" | "PHONE" | "MOBILE" | "WHATSAPP" | "FAX";
  value: string;
  isPrimary: boolean;
  optIn: boolean;
}

export interface GuestAddressView {
  id: string;
  type: "HOME" | "BUSINESS" | "BILLING" | "OTHER";
  line1: string;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isPrimary: boolean;
}

export interface GuestPreferenceView {
  id: string;
  preferenceCode: Ref & { groupCode: string };
  /** Null = every property. */
  property: { id: string; code: string } | null;
  note: string | null;
}

export interface GuestNoteView {
  id: string;
  body: string;
  visibility: "ALL_STAFF" | "MANAGEMENT" | "INTERNAL";
  isAlert: boolean;
  property: { id: string; code: string } | null;
  createdBy: string | null;
  createdAt: string;
  canDelete: boolean;
}

export interface GuestCompanyView {
  account: { id: string; code: string | null; name: string; type: string; status: string };
  kind: "EMPLOYEE" | "CONTACT" | "ASSOCIATE";
  role: string | null;
  isPrimary: boolean;
}

export interface LoyaltyMembershipView {
  id: string;
  version: number;
  program: Ref;
  membershipNumber: string;
  tier: (Ref & { rank: number }) | null;
  status: "ACTIVE" | "INACTIVE";
  pointsBalance: string;
  enrolledAt: string;
  changes: {
    id: string;
    type: "ENROLLED" | "TIER_CHANGED" | "STATUS_CHANGED";
    fromTier: string | null;
    toTier: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    by: string | null;
    at: string;
  }[];
  transactions: {
    id: string;
    type: "EARN" | "REDEEM" | "ADJUST" | "EXPIRE";
    points: string;
    description: string | null;
    at: string;
  }[];
}

/**
 * Full guest profile (organization data). Property facts are limited to the
 * properties where the caller may see them; sensitive fields are null
 * without guests:read_sensitive (see `access`).
 */
export interface GuestProfileView extends GuestSummaryView {
  version: number;
  status: "ACTIVE" | "INACTIVE" | "MERGED" | "ANONYMIZED";
  middleName: string | null;
  preferredName: string | null;
  displayName: string;
  gender: string | null;
  /** Null without guests:read_sensitive. */
  dateOfBirth: string | null;
  languageCode: string | null;
  preferredContact: GuestContactView["type"] | null;
  marketingOptIn: boolean;
  restrictionReason: string | null;
  vipLevelId: string | null;
  contacts: GuestContactView[];
  addresses: GuestAddressView[];
  preferences: GuestPreferenceView[];
  notes: GuestNoteView[];
  /** Recognition alerts (alert notes the caller may read). */
  alerts: string[];
  /** Null without accounts:read. */
  companies: GuestCompanyView[] | null;
  /** Null without loyalty:read. */
  loyalty: LoyaltyMembershipView[] | null;
  statistics: {
    stays: number;
    nights: number;
    upcoming: number;
    cancellations: number;
    noShows: number;
    lastStay: string | null;
  };
  createdAt: string;
  updatedAt: string;
  /** Audit trail of the profile and its memberships; null without audit:read. */
  history: ResourceHistoryEntry[] | null;
  access: {
    update: boolean;
    readSensitive: boolean;
    addNote: boolean;
    manageCompanies: boolean;
    /** Preferences for every property need an organization-scope grant (D3). */
    manageGlobalPreferences: boolean;
    /** Enrolment is open to property staff with loyalty:manage. */
    enrollLoyalty: boolean;
    /** Tier/status changes and point adjustments need organization scope (D3). */
    manageLoyalty: boolean;
    readHistory: boolean;
  };
}

export interface GuestOptions {
  vipLevels: Ref[];
  preferenceCodes: (Ref & { groupCode: string })[];
  /** Properties the caller may attach property-specific preferences / notes to. */
  properties: { id: string; code: string; name: string }[];
}

export interface GuestHistoryRow {
  reservationRoomId: string;
  reservationId: string;
  property: { id: string; code: string; name: string };
  confirmation: string;
  status: string;
  arrival: string;
  departure: string;
  nights: number;
  roomType: string;
  room: string | null;
  ratePlan: string;
  company: string | null;
  group: string | null;
  isPrimaryGuest: boolean;
  stay: { id: string; status: string } | null;
  /** Null without billing:read at that property. */
  roomTotal: string | null;
  balance: string | null;
  currencyCode: string;
}

export interface GuestHistoryPage {
  items: GuestHistoryRow[];
  nextCursor: string | null;
  /** Properties included (where the caller holds reservations:read). */
  properties: { id: string; code: string; name: string }[];
}

export interface PossibleDuplicate {
  id: string;
  profileNumber: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}
