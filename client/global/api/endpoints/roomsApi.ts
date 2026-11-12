import { API } from "@/global/constants/api";
import type {
  ApiSuccess,
  InspectRoomInput,
  PlaceBlockInput,
  ReleaseBlockInput,
  RoomBoardView,
  RoomDetail,
  RoomHousekeepingInput,
  RoomPickerItem,
} from "../types";
import { baseApi } from "../baseApi";
import { operationsTags } from "./operationsTags";
import { optionsTag } from "./optionsTags";

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

/** Inspection and clean/dirty change cleaning status only, never availability (B11). */
function afterHousekeepingCommand(
  _r: unknown,
  _e: unknown,
  arg: { propertyId: string; roomId?: string },
) {
  return [
    ...operationsTags(arg.propertyId, { availability: false }),
    ...(arg.roomId ? [{ type: "Room" as const, id: arg.roomId }] : []),
  ];
}

export const roomsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    roomPicker: build.query<RoomPickerItem[], string>({
      query: (propertyId) => API.rooms.roomsPicker(propertyId),
      transformResponse: (response: ApiSuccess<RoomPickerItem[]>) => response.data,
      providesTags: (_r, _e, propertyId) => [optionsTag(propertyId)],
      keepUnusedDataFor: 300,
    }),
    roomBoardView: build.query<
      RoomBoardView,
      {
        propertyId: string;
        filter?: string;
        roomTypeId?: string;
        floorId?: string;
        offset?: string;
      }
    >({
      query: ({ propertyId, ...params }) =>
        `${API.rooms.roomsBoard(propertyId)}?${toQuery(params)}`,
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
      query: (propertyId) => API.rooms.roomsBoardOptions(propertyId),
      transformResponse: (
        response: ApiSuccess<{
          floors: { id: string; name: string }[];
          roomTypes: Code[];
          blockReasons: (Code & { category: string })[];
        }>,
      ) => response.data,
      providesTags: (_r, _e, propertyId) => [optionsTag(propertyId)],
      keepUnusedDataFor: 300,
    }),
    room: build.query<RoomDetail, { propertyId: string; roomId: string }>({
      query: ({ propertyId, roomId }) => API.rooms.room(propertyId, roomId),
      transformResponse: (response: ApiSuccess<RoomDetail>) => response.data,
      providesTags: (_r, _e, { roomId, propertyId }) => [
        { type: "Room", id: roomId },
        { type: "RoomStatus", id: `BOARD-${propertyId}` },
      ],
    }),
    placeRoomBlock: build.mutation<RoomDetail, RoomCommand<PlaceBlockInput>>({
      query: ({ propertyId, roomId, body }) => ({
        url: API.rooms.roomBlocks(propertyId, roomId),
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
        url: API.rooms.roomBlockRelease(propertyId, blockId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<RoomDetail>) => response.data,
      invalidatesTags: afterRoomCommand,
    }),
    inspectRoom: build.mutation<unknown, RoomCommand<Partial<InspectRoomInput>>>({
      query: ({ propertyId, roomId, body }) => ({
        url: API.rooms.roomInspect(propertyId, roomId),
        method: "POST",
        body,
      }),
      invalidatesTags: afterHousekeepingCommand,
    }),
    setRoomHousekeeping: build.mutation<
      unknown,
      RoomCommand<RoomHousekeepingInput> & { action: "mark-dirty" | "mark-clean" }
    >({
      query: ({ propertyId, roomId, action, body }) => ({
        url: API.rooms.roomAction(propertyId, roomId, action),
        method: "POST",
        body,
      }),
      invalidatesTags: afterHousekeepingCommand,
    }),
  }),
});

export const {
  useRoomBoardViewQuery,
  useRoomPickerQuery,
  useRoomBoardOptionsQuery,
  useRoomQuery,
  usePlaceRoomBlockMutation,
  useReleaseRoomBlockMutation,
  useInspectRoomMutation,
  useSetRoomHousekeepingMutation,
} = roomsApi;
