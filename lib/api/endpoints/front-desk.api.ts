import type {
  CheckInInput,
  CheckOutInput,
  RoomMoveInput,
  WalkInInput,
} from "@/modules/front-desk/front-desk.schema";
import type {
  ArrivalRow,
  FrontDeskSummary,
  RoomBoardRow,
  RoomOption,
  StayDetail,
  StayRow,
} from "@/modules/front-desk/front-desk.types";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";
import { baseApi } from "../baseApi";

/**
 * Front desk endpoints (Phase 3). Shared by the front desk workspace, the
 * stay page, the walk-in workflow and the reservation detail (check-in).
 * Every front desk list provides the property's `Stay` list tag; every
 * command invalidates it together with reservations and availability.
 */

type ListArgs = { propertyId: string } & Record<string, string | undefined>;
type Page<T> = { items: T[]; meta: CursorPageMeta };

const toQuery = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
};

const listTag = (propertyId: string) => ({ type: "Stay" as const, id: `FD-${propertyId}` });

function afterCommand(
  result: StayDetail | undefined,
  _error: unknown,
  arg: { propertyId: string },
) {
  return [
    listTag(arg.propertyId),
    { type: "Reservation" as const, id: `LIST-${arg.propertyId}` },
    { type: "Availability" as const, id: arg.propertyId },
    ...(result
      ? [
          { type: "Stay" as const, id: result.id },
          { type: "Reservation" as const, id: result.reservationId },
        ]
      : []),
  ];
}

const toPage = <T>(response: ApiSuccess<T[], CursorPageMeta>): Page<T> => ({
  items: response.data,
  meta: response.meta ?? { nextCursor: null, limit: 0 },
});

export const frontDeskApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    frontDeskSummary: build.query<FrontDeskSummary, string>({
      query: (propertyId) => `/properties/${propertyId}/front-desk/summary`,
      transformResponse: (response: ApiSuccess<FrontDeskSummary>) => response.data,
      providesTags: (_r, _e, propertyId) => [listTag(propertyId)],
    }),
    arrivals: build.query<Page<ArrivalRow>, ListArgs>({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/front-desk/arrivals?${toQuery(params)}`,
      transformResponse: toPage<ArrivalRow>,
      providesTags: (_r, _e, { propertyId }) => [listTag(propertyId)],
    }),
    inHouse: build.query<Page<StayRow>, ListArgs>({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/front-desk/in-house?${toQuery(params)}`,
      transformResponse: toPage<StayRow>,
      providesTags: (_r, _e, { propertyId }) => [listTag(propertyId)],
    }),
    departures: build.query<Page<StayRow>, ListArgs>({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/front-desk/departures?${toQuery(params)}`,
      transformResponse: toPage<StayRow>,
      providesTags: (_r, _e, { propertyId }) => [listTag(propertyId)],
    }),
    roomBoard: build.query<RoomBoardRow[], ListArgs>({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/front-desk/rooms?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<RoomBoardRow[]>) => response.data,
      providesTags: (_r, _e, { propertyId }) => [listTag(propertyId)],
    }),
    roomOptions: build.query<RoomOption[], { propertyId: string; reservationRoomId: string }>({
      query: ({ propertyId, reservationRoomId }) =>
        `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/room-options`,
      transformResponse: (response: ApiSuccess<RoomOption[]>) => response.data,
      providesTags: (_r, _e, { propertyId }) => [listTag(propertyId)],
      keepUnusedDataFor: 0,
    }),
    stay: build.query<StayDetail, { propertyId: string; stayId: string }>({
      query: ({ propertyId, stayId }) => `/properties/${propertyId}/stays/${stayId}`,
      transformResponse: (response: ApiSuccess<StayDetail>) => response.data,
      providesTags: (_r, _e, { stayId }) => [{ type: "Stay", id: stayId }],
    }),
    checkIn: build.mutation<
      StayDetail,
      { propertyId: string; reservationRoomId: string; body: Partial<CheckInInput> }
    >({
      query: ({ propertyId, reservationRoomId, body }) => ({
        url: `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/check-in`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<StayDetail>) => response.data,
      invalidatesTags: afterCommand,
    }),
    walkIn: build.mutation<StayDetail, { propertyId: string; body: Partial<WalkInInput> }>({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/front-desk/walk-ins`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<StayDetail>) => response.data,
      invalidatesTags: afterCommand,
    }),
    moveRoom: build.mutation<
      StayDetail,
      { propertyId: string; stayId: string; body: Partial<RoomMoveInput> }
    >({
      query: ({ propertyId, stayId, body }) => ({
        url: `/properties/${propertyId}/stays/${stayId}/room-move`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<StayDetail>) => response.data,
      invalidatesTags: afterCommand,
    }),
    checkOut: build.mutation<
      StayDetail,
      { propertyId: string; stayId: string; body: Partial<CheckOutInput> }
    >({
      query: ({ propertyId, stayId, body }) => ({
        url: `/properties/${propertyId}/stays/${stayId}/check-out`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<StayDetail>) => response.data,
      invalidatesTags: afterCommand,
    }),
  }),
});

export const {
  useFrontDeskSummaryQuery,
  useArrivalsQuery,
  useInHouseQuery,
  useDeparturesQuery,
  useRoomBoardQuery,
  useRoomOptionsQuery,
  useStayQuery,
  useCheckInMutation,
  useWalkInMutation,
  useMoveRoomMutation,
  useCheckOutMutation,
} = frontDeskApi;
