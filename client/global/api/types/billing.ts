/** Types used by the billing endpoints (re-exported from the shared contracts). */
export type {
  AdjustInput,
  ChargeInput,
  PaymentInput,
  RefundInput,
  ReverseInput,
  RoomChargesInput,
  VoidPaymentInput,
} from "@serene/shared/modules/billing/billing.schema";
export type {
  BillingOptions,
  ChargePreview,
  FolioAccountView,
  FolioListRow,
  LedgerPage,
  PaymentResult,
  PostingResult,
  RoomChargesResult,
} from "@serene/shared/modules/billing/billing.types";
