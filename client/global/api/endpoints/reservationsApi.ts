import { API } from "@/global/constants/api";
import type {
  ApiSuccess,
  AssignRoomInput,
  AvailabilityQuery,
  AvailabilityView,
  AvailableRoomView,
  BookingOptions,
  CancelReservationInput,
  ConfirmReservationInput,
  CreateReservationInput,
  CursorPageMeta,
  ReinstateReservationInput,
  ReservationCompanyInput,
  ReservationDetail,
  ReservationListItem,
  ReservationPackageInput,
  StayChargeEstimate,
  UpdateReservationRoomInput,
} from "../types";
import { baseApi } from "../baseApi";
import { optionsTag } from "./optionsTags";

/**
 * Availability and reservation endpoints. Shared by the availability,
 * reservation list, new reservation and reservation detail routes.
 * The property id is part of every argument, so of every cache key.
 */

type WithProperty<T> = T & { propertyId: string };
type RoomCommand<T> = { propertyId: string; reservationRoomId: string; body: T };

export type ReservationListArgs = WithProperty<Record<string, string | undefined>>;

const toQuery = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search.toString();
};

export const reservationsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    availability: build.query<AvailabilityView, WithProperty<Partial<AvailabilityQuery>>>({
      query: ({ propertyId, ...params }) =>
        `${API.reservations.availability(propertyId)}?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<AvailabilityView>) => response.data,
      providesTags: (_r, _e, { propertyId }) => [{ type: "Availability", id: propertyId }],
    }),
    bookingOptions: build.query<BookingOptions, string>({
      query: (propertyId) => API.reservations.bookingOptions(propertyId),
      transformResponse: (response: ApiSuccess<BookingOptions>) => response.data,
      providesTags: (_r, _e, propertyId) => [optionsTag(propertyId)],
      keepUnusedDataFor: 300,
    }),
    availableRooms: build.query<
      AvailableRoomView[],
      {
        propertyId: string;
        roomTypeId: string;
        arrival: string;
        departure: string;
        excludeReservationRoomId?: string;
      }
    >({
      query: ({ propertyId, ...params }) =>
        `${API.reservations.roomsAvailable(propertyId)}?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<AvailableRoomView[]>) => response.data,
      providesTags: (_r, _e, { propertyId }) => [{ type: "Availability", id: propertyId }],
    }),
    reservations: build.query<
      { items: ReservationListItem[]; meta: CursorPageMeta },
      ReservationListArgs
    >({
      query: ({ propertyId, ...params }) =>
        `${API.reservations.reservations(propertyId)}?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<ReservationListItem[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: (result, _e, { propertyId }) => [
        { type: "Reservation", id: `LIST-${propertyId}` },
        ...(result?.items.map((item) => ({
          type: "Reservation" as const,
          id: item.reservationId,
        })) ?? []),
      ],
    }),
    reservation: build.query<ReservationDetail, { propertyId: string; reservationId: string }>({
      query: ({ propertyId, reservationId }) =>
        API.reservations.reservation(propertyId, reservationId),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      providesTags: (_r, _e, { reservationId }) => [{ type: "Reservation", id: reservationId }],
    }),
    createReservation: build.mutation<
      ReservationDetail,
      // idempotencyKey: chosen once per booking screen, so a retried request returns the
      // first booking instead of booking twice (PRODUCTION_READINESS P2-3).
      WithProperty<{ body: Partial<CreateReservationInput>; idempotencyKey?: string }>
    >({
      query: ({ propertyId, body, idempotencyKey }) => ({
        url: API.reservations.reservations(propertyId),
        method: "POST",
        body,
        ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => [
        { type: "Reservation", id: `LIST-${propertyId}` },
        { type: "Availability", id: propertyId },
        { type: "Stay", id: `FD-${propertyId}` },
      ],
    }),
    updateReservationRoom: build.mutation<
      ReservationDetail,
      RoomCommand<Partial<UpdateReservationRoomInput>>
    >({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: API.reservations.reservationRoom(propertyId, reservationRoomId),
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    confirmReservation: build.mutation<
      ReservationDetail,
      RoomCommand<Partial<ConfirmReservationInput>>
    >({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: API.reservations.reservationRoomConfirm(propertyId, reservationRoomId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    cancelReservation: build.mutation<ReservationDetail, RoomCommand<CancelReservationInput>>({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: API.reservations.reservationRoomCancel(propertyId, reservationRoomId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    markNoShow: build.mutation<ReservationDetail, RoomCommand<CancelReservationInput>>({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: API.reservations.reservationRoomNoShow(propertyId, reservationRoomId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    reinstateReservation: build.mutation<
      ReservationDetail,
      RoomCommand<Partial<ReinstateReservationInput>>
    >({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: API.reservations.reservationRoomReinstate(propertyId, reservationRoomId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    /** A no-show who arrives after all: reserved again from the business date (Phase 8). */
    reinstateNoShow: build.mutation<
      ReservationDetail,
      RoomCommand<Partial<ReinstateReservationInput>>
    >({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: API.reservations.reservationRoomReinstateNoShow(propertyId, reservationRoomId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    /** Company and booking contact of a reservation (Phase 7). */
    setReservationCompany: build.mutation<
      ReservationDetail,
      { propertyId: string; reservationId: string; body: ReservationCompanyInput }
    >({
      query: ({ propertyId, reservationId, body }) => ({
        url: API.reservations.reservationCompany(propertyId, reservationId),
        method: "PUT",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: ["Reservation", "Account"],
    }),
    assignRoom: build.mutation<ReservationDetail, RoomCommand<AssignRoomInput>>({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: API.reservations.reservationRoomAssignRoom(propertyId, reservationRoomId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
  }),
});

function invalidateAfterCommand(
  result: ReservationDetail | undefined,
  _error: unknown,
  arg: { propertyId: string },
) {
  return [
    { type: "Reservation" as const, id: `LIST-${arg.propertyId}` },
    { type: "Availability" as const, id: arg.propertyId },
    // Front desk lists (arrivals, room board) show reservation state too.
    { type: "Stay" as const, id: `FD-${arg.propertyId}` },
    // Cancelling or reinstating a block pickup changes the group's pickup.
    "Block" as const,
    ...(result ? [{ type: "Reservation" as const, id: result.id }] : []),
  ];
}

/** Packages on a reservation and its expected charges (Phase 6). */
export const reservationPackagesApi = reservationsApi.injectEndpoints({
  endpoints: (build) => ({
    chargeEstimate: build.query<
      StayChargeEstimate,
      { propertyId: string; reservationRoomId: string }
    >({
      query: ({ propertyId, reservationRoomId }) =>
        API.reservations.reservationRoomChargeEstimate(propertyId, reservationRoomId),
      transformResponse: (response: ApiSuccess<StayChargeEstimate>) => response.data,
      providesTags: ["Reservation", "RatePlan"],
    }),
    addReservationPackage: build.mutation<ReservationDetail, RoomCommand<ReservationPackageInput>>({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: API.reservations.reservationRoomPackages(propertyId, reservationRoomId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: ["Reservation", "Folio"],
    }),
    removeReservationPackage: build.mutation<
      ReservationDetail,
      { propertyId: string; reservationRoomId: string; reservationPackageId: string }
    >({
      query: ({ propertyId, reservationRoomId, reservationPackageId }) => ({
        url: API.reservations.reservationRoomPackage(
          propertyId,
          reservationRoomId,
          reservationPackageId,
        ),
        method: "DELETE",
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: ["Reservation", "Folio"],
    }),
  }),
});

export const {
  useChargeEstimateQuery,
  useAddReservationPackageMutation,
  useRemoveReservationPackageMutation,
} = reservationPackagesApi;

export const {
  useAvailabilityQuery,
  useBookingOptionsQuery,
  useAvailableRoomsQuery,
  useReservationsQuery,
  useReservationQuery,
  useCreateReservationMutation,
  useUpdateReservationRoomMutation,
  useConfirmReservationMutation,
  useCancelReservationMutation,
  useMarkNoShowMutation,
  useReinstateReservationMutation,
  useReinstateNoShowMutation,
  useAssignRoomMutation,
  useSetReservationCompanyMutation,
} = reservationsApi;
