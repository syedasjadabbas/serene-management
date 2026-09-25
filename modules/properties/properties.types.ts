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
}

export interface PropertyConfigurationView {
  propertyId: string;
  timezone: string;
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
