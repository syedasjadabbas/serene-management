/** Types used by the reservations endpoints (re-exported from the shared contracts). */
export type { AvailabilityQuery } from "@serene/shared/modules/availability/availability.schema";
export type { AvailabilityView } from "@serene/shared/modules/availability/availability.types";
export type {
  AssignRoomInput,
  CancelReservationInput,
  ConfirmReservationInput,
  CreateReservationInput,
  ReinstateReservationInput,
  ReservationCompanyInput,
  UpdateReservationRoomInput,
} from "@serene/shared/modules/reservations/reservations.schema";
export type {
  AvailableRoomView,
  BookingOptions,
  ReservationDetail,
  ReservationListItem,
} from "@serene/shared/modules/reservations/reservations.types";
export type { StayChargeEstimate } from "@serene/shared/modules/billing/billing.types";
export type { ReservationPackageInput } from "@serene/shared/modules/rates/rates.schema";
