export interface OrganizationView {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  baseCurrency: string;
}

export interface PropertyView {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  timezone: string;
  currencyCode: string;
  countryCode: string;
  defaultLocale: string;
  checkInTime: string;
  checkOutTime: string;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
  };
  phone: string | null;
  email: string | null;
  /** Prefix of new confirmation numbers ("SMR" → "SMR-100045"). */
  confirmationPrefix: string;
}

export interface PropertyConfigurationView {
  propertyId: string;
  timezone: string;
  confirmationPrefix: string;
  checkInTime: string;
  checkOutTime: string;
  maxFolioWindows: number;
  allowOverbooking: boolean;
  requireInspectedForCheckIn: boolean;
  usePickupStatus: boolean;
  useInspectedStatus: boolean;
  autoNoShowOnNightAudit: boolean;
  postNoShowCharges: boolean;
  requireZeroBalanceCheckout: boolean;
  allowCancelWithDeposit: boolean;
  autoCloseCashiersOnAudit: boolean;
  roomHoldDefaultMinutes: number;
  noShowTransactionCodeId: string | null;
  noShowReasonCodeId: string | null;
  updatedAt: string | null;
}

/** One kind of reference data in a setup copy (D37). */
export interface PropertySetupSection {
  key: string;
  label: string;
  copied: number;
  /** Already present in the target (same code), or not copyable. */
  skipped: number;
  /** Codes not copied or copied without amounts: they need a manual review. */
  needsReview: string[];
}

export interface PropertySetupCopyResult {
  sourceProperty: { id: string; code: string; currencyCode: string };
  targetProperty: { id: string; code: string; currencyCode: string };
  sections: PropertySetupSection[];
  copied: number;
  skipped: number;
}
