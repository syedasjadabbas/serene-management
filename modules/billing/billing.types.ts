import type { FolioStatus } from "./billing.policy";

/** Money on the wire: decimal strings with 4 fraction digits ("1250.0000"). */
type Money = string;

export interface FolioWindowView {
  id: string;
  window: number;
  status: FolioStatus;
  currencyCode: string;
  payeeName: string | null;
  /** Ledger-maintained totals (database trigger). */
  chargesTotal: Money;
  creditsTotal: Money;
  balance: Money;
  version: number;
  openedAt: string;
  settledAt: string | null;
  closedAt: string | null;
}

export interface FolioActions {
  postCharge: boolean;
  postRoomCharges: boolean;
  takePayment: boolean;
  openWindow: boolean;
  settle: boolean;
  reverse: boolean;
  adjust: boolean;
  voidPayment: boolean;
  refund: boolean;
  viewHistory: boolean;
}

export interface FolioAccountView {
  reservationRoomId: string;
  confirmation: string;
  stayId: string | null;
  stayStatus: "IN_HOUSE" | "CHECKED_OUT" | null;
  reservationStatus: string;
  guest: { id: string; name: string };
  room: { id: string; number: string } | null;
  roomType: { code: string; name: string };
  ratePlanCode: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  businessDate: string;
  currencyCode: string;
  minorUnits: number;
  maxWindows: number;
  requireZeroBalanceCheckout: boolean;
  windows: FolioWindowView[];
  totals: { charges: Money; credits: Money; balance: Money };
  roomCharges: {
    /** Stay nights up to the business date with no live room posting yet. */
    unpostedNights: string[];
    postedNights: number;
    totalNights: number;
  };
  actions: FolioActions;
}

export interface LedgerItemView {
  id: string;
  folioId: string;
  kind: string;
  source: string;
  businessDate: string;
  revenueDate: string | null;
  postedAt: string;
  description: string;
  reference: string | null;
  comment: string | null;
  code: { id: string; code: string; name: string };
  quantity: string;
  unitAmount: Money;
  /** Signed ledger amount (charges > 0, credits < 0). */
  amount: Money;
  runningBalance: Money;
  parentItemId: string | null;
  correctsItemId: string | null;
  reasonCode: string | null;
  postedBy: string | null;
  reversed: boolean;
  /** Sum of adjustments against this line (<= 0), "0.0000" when none. */
  adjusted: Money;
  payment: {
    id: string;
    receiptNumber: string | null;
    method: string;
    status: string;
    refundable: Money;
  } | null;
  actions: { reverse: boolean; adjust: boolean; void: boolean; refund: boolean };
}

export interface LedgerPage {
  items: LedgerItemView[];
  nextCursor: string | null;
}

export interface ChargePreview {
  currencyCode: string;
  quantity: number;
  unitAmount: Money;
  inclusive: boolean;
  net: Money;
  taxes: { code: string; name: string; amount: Money }[];
  total: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

/** Stored with the idempotency key and replayed verbatim on a retry. */
export interface PostingResult {
  folioId: string;
  itemIds: string[];
  total: Money;
  balance: Money;
  version: number;
}

export interface RoomChargesResult {
  reservationRoomId: string;
  postedNights: string[];
  itemIds: string[];
  total: Money;
}

export interface PaymentResult {
  folioId: string;
  paymentId: string;
  receiptNumber: string | null;
  itemId: string;
  amount: Money;
  balance: Money;
  version: number;
}

export interface FolioListRow {
  reservationRoomId: string;
  confirmation: string;
  guestName: string;
  roomNumber: string | null;
  arrival: string;
  departure: string;
  stayStatus: "IN_HOUSE" | "CHECKED_OUT" | null;
  windows: number;
  currencyCode: string;
  balance: Money;
  /** Null when no window has been opened yet. */
  status: FolioStatus | null;
}

export interface BillingOptions {
  currencyCode: string;
  minorUnits: number;
  businessDate: string | null;
  chargeCodes: {
    id: string;
    code: string;
    name: string;
    group: string;
    defaultPrice: Money | null;
    minAmount: Money | null;
    maxAmount: Money | null;
    taxInclusive: boolean;
  }[];
  paymentMethods: {
    id: string;
    code: string;
    name: string;
    kind: string;
    requiresReference: boolean;
  }[];
  reasonCodes: { id: string; category: string; code: string; name: string }[];
}

export interface FolioSummary {
  windows: number;
  currencyCode: string;
  minorUnits: number;
  balance: Money;
  status: FolioStatus;
}
