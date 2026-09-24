import type {
  InspectRoomInput,
  RoomHousekeepingInput,
} from "@/modules/housekeeping/housekeeping.schema";
import type { PlaceBlockInput, ReleaseBlockInput } from "@/modules/rooms/rooms.schema";
import type { RoomBoardView, RoomDetail } from "@/modules/rooms/rooms.types";
import type { ApiSuccess } from "@/types/api";
import { baseApi } from "../baseApi";
import { operationsTags } from "./operations-tags";

/**
 * Rooms: the shared room board, room detail, out-of-order / out-of-service
 * blocks, and room-level housekeeping (inspection, mark dirty / clean).
 * Used by the front desk, housekeeping and maintenance workspaces.
 */

type Code = { id: string; code: string; name: string };
type RoomCommand<T> = { propertyId: string; roomId: string; body: T };

const toQuery = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
};

function afterRoomCommand(_r: unknown, _e: unknown, arg: { propertyId: string; roomId?: string }) {
  return [
    ...operationsTags(arg.propertyId),
    ...(arg.roomId ? [{ type: "Room" as const, id: arg.roomId }] : []),
  ];
}

export const roomsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    roomBoardView: build.query<
      RoomBoardView,
      { propertyId: string; filter?: string; roomTypeId?: string; floorId?: string }
    >({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/rooms/board?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<RoomBoardView>) => response.data,
      providesTags: (_r, _e, { propertyId }) => [{ type: "RoomStatus", id: `BOARD-${propertyId}` }],
    }),
    roomBoardOptions: build.query<
      {
        floors: { id: string; name: string }[];
        roomTypes: Code[];
        blockReasons: (Code & { category: string })[];
      },
      string
    >({
      query: (propertyId) => `/properties/${propertyId}/rooms/board-options`,
      transformResponse: (
        response: ApiSuccess<{
          floors: { id: string; name: string }[];
          roomTypes: Code[];
          blockReasons: (Code & { category: string })[];
        }>,
      ) => response.data,
      keepUnusedDataFor: 300,
    }),
    room: build.query<RoomDetail, { propertyId: string; roomId: string }>({
      query: ({ propertyId, roomId }) => `/properties/${propertyId}/rooms/${roomId}`,
      transformResponse: (response: ApiSuccess<RoomDetail>) => response.data,
      providesTags: (_r, _e, { roomId, propertyId }) => [
        { type: "Room", id: roomId },
        { type: "RoomStatus", id: `BOARD-${propertyId}` },
      ],
    }),
    placeRoomBlock: build.mutation<RoomDetail, RoomCommand<PlaceBlockInput>>({
      query: ({ propertyId, roomId, body }) => ({
        url: `/properties/${propertyId}/rooms/${roomId}/blocks`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<RoomDetail>) => response.data,
      invalidatesTags: afterRoomCommand,
    }),
    releaseRoomBlock: build.mutation<
      RoomDetail,
      { propertyId: string; blockId: string; roomId: string; body: ReleaseBlockInput }
    >({
      query: ({ propertyId, blockId, body }) => ({
        url: `/properties/${propertyId}/room-blocks/${blockId}/release`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<RoomDetail>) => response.data,
      invalidatesTags: afterRoomCommand,
    }),
    inspectRoom: build.mutation<unknown, RoomCommand<Partial<InspectRoomInput>>>({
      query: ({ propertyId, roomId, body }) => ({
        url: `/properties/${propertyId}/rooms/${roomId}/inspect`,
        method: "POST",
        body,
      }),
      invalidatesTags: afterRoomCommand,
    }),
    setRoomHousekeeping: build.mutation<
      unknown,
      RoomCommand<RoomHousekeepingInput> & { action: "mark-dirty" | "mark-clean" }
    >({
      query: ({ propertyId, roomId, action, body }) => ({
        url: `/properties/${propertyId}/rooms/${roomId}/${action}`,
        method: "POST",
        body,
      }),
      invalidatesTags: afterRoomCommand,
    }),
  }),
});

export const {
  useRoomBoardViewQuery,
  useRoomBoardOptionsQuery,
  useRoomQuery,
  usePlaceRoomBlockMutation,
  useReleaseRoomBlockMutation,
  useInspectRoomMutation,
  useSetRoomHousekeepingMutation,
} = roomsApi;
