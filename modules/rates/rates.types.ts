/** Rate administration views (Phase 6). Money is decimal strings. */

type Money = string;
type Ref = { id: string; code: string; name: string };

export interface RatePlanListItem {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: "ACTIVE" | "INACTIVE";
  currencyCode: string;
  taxInclusive: boolean;
  version: number;
  displayOrder: number;
  parent: { id: string; code: string } | null;
  derivation: { type: "PERCENT" | "AMOUNT"; value: Money } | null;
  roomTypes: string[];
  seasons: number;
  packages: string[];
  requiresNegotiation: boolean;
}

export interface SeasonView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  daysOfWeek: number;
  priority: number;
  amounts: {
    roomTypeId: string;
    roomTypeCode: string;
    oneAdult: Money;
    twoAdults: Money | null;
    threeAdults: Money | null;
    fourAdults: Money | null;
    extraAdult: Money | null;
    extraChild: Money | null;
  }[];
}

export interface RatePlanDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: string;
  status: "ACTIVE" | "INACTIVE";
  currencyCode: string;
  taxInclusive: boolean;
  version: number;
  displayOrder: number;
  categoryId: string | null;
  roomTransactionCode: Ref;
  derivation: {
    parentRatePlanId: string;
    parentCode: string;
    type: "PERCENT" | "AMOUNT";
    value: Money;
    roundingIncrement: Money | null;
  } | null;
  sellFrom: string | null;
  sellTo: string | null;
  stayFrom: string | null;
  stayTo: string | null;
  cancellationPolicyId: string | null;
  depositPolicyId: string | null;
  defaultMarketCodeId: string | null;
  defaultSourceCodeId: string | null;
  roomTypeIds: string[];
  seasons: SeasonView[];
  packages: Ref[];
  derivedPlans: Ref[];
  requiresNegotiation: boolean;
  /** Companies the plan is sold to (negotiated plans). */
  negotiated: {
    account: { id: string; code: string | null; name: string };
    validFrom: string | null;
    validTo: string | null;
  }[];
  actions: { manage: boolean; managePackages: boolean };
}

export interface RateAdminOptions {
  currencyCode: string;
  minorUnits: number;
  businessDate: string | null;
  roomTypes: Ref[];
  roomChargeCodes: Ref[];
  packageChargeCodes: Ref[];
  categories: Ref[];
  cancellationPolicies: Ref[];
  depositPolicies: Ref[];
  marketCodes: Ref[];
  sourceCodes: Ref[];
  ratePlans: (Ref & { status: string; parentRatePlanId: string | null })[];
  packages: (Ref & { status: string; sellSeparately: boolean })[];
}

export interface RateCalendarDay {
  date: string;
  seasonName: string | null;
  oneAdult: Money | null;
  twoAdults: Money | null;
  restrictions: {
    type: string;
    value: number | null;
    scope: "HOUSE" | "ROOM_TYPE" | "RATE_PLAN" | "ROOM_TYPE_AND_RATE_PLAN";
  }[];
}

export interface RateCalendarView {
  ratePlan: { id: string; code: string; name: string; status: string; derived: boolean };
  roomType: { id: string; code: string; name: string };
  currencyCode: string;
  minorUnits: number;
  days: RateCalendarDay[];
}

export interface PackageView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  postingType: "INCLUDED_IN_RATE" | "SEPARATE_LINE" | "COMBINED_WITH_ROOM";
  sellSeparately: boolean;
  status: "ACTIVE" | "INACTIVE";
  ratePlans: string[];
  components: {
    id: string;
    name: string;
    transactionCode: Ref;
    calculation: string;
    rhythm: string;
    daysOfWeek: number;
    unitPrice: Money;
  }[];
}
