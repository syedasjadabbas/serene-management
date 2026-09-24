import type { AvailabilityQuery } from "@/modules/availability/availability.schema";
import type { AvailabilityView } from "@/modules/availability/availability.types";
import type {
  AssignRoomInput,
  CancelReservationInput,
  ConfirmReservationInput,
  CreateReservationInput,
  ReinstateReservationInput,
  UpdateReservationRoomInput,
} from "@/modules/reservations/reservations.schema";
import type {
  AvailableRoomView,
  BookingOptions,
  ReservationDetail,
  ReservationListItem,
} from "@/modules/reservations/reservations.types";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";
import { baseApi } from "../baseApi";

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
        `/properties/${propertyId}/availability?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<AvailabilityView>) => response.data,
      providesTags: (_r, _e, { propertyId }) => [{ type: "Availability", id: propertyId }],
    }),
    bookingOptions: build.query<BookingOptions, string>({
      query: (propertyId) => `/properties/${propertyId}/booking-options`,
      transformResponse: (response: ApiSuccess<BookingOptions>) => response.data,
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
        `/properties/${propertyId}/rooms/available?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<AvailableRoomView[]>) => response.data,
      providesTags: (_r, _e, { propertyId }) => [{ type: "Availability", id: propertyId }],
    }),
    reservations: build.query<
      { items: ReservationListItem[]; meta: CursorPageMeta },
      ReservationListArgs
    >({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/reservations?${toQuery(params)}`,
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
        `/properties/${propertyId}/reservations/${reservationId}`,
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      providesTags: (_r, _e, { reservationId }) => [{ type: "Reservation", id: reservationId }],
    }),
    createReservation: build.mutation<
      ReservationDetail,
      WithProperty<{ body: Partial<CreateReservationInput> }>
    >({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/reservations`,
        method: "POST",
        body,
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
        url: `/properties/${propertyId}/reservation-rooms/${reservationRoomId}`,
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
        url: `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/confirm`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    cancelReservation: build.mutation<ReservationDetail, RoomCommand<CancelReservationInput>>({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/cancel`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    markNoShow: build.mutation<ReservationDetail, RoomCommand<CancelReservationInput>>({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/no-show`,
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
        url: `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/reinstate`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ReservationDetail>) => response.data,
      invalidatesTags: invalidateAfterCommand,
    }),
    assignRoom: build.mutation<ReservationDetail, RoomCommand<AssignRoomInput>>({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/assign-room`,
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
    ...(result ? [{ type: "Reservation" as const, id: result.id }] : []),
  ];
}

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
  useAssignRoomMutation,
} = reservationsApi;
