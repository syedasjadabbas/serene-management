import type {
  AllocationInput,
  BlockStatusInput,
  CreateBlockInput,
  CreateGroupInput,
  GroupStatusInput,
  PickupInput,
  ReleaseInput,
  UpdateGroupInput,
} from "@/modules/groups/groups.schema";
import type {
  GroupDetail,
  GroupListItem,
  GroupOptions,
  PickupResult,
  ReleaseResult,
} from "@/modules/groups/groups.types";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";
import { baseApi } from "../baseApi";

/**
 * Groups, blocks and pickup (Phase 6). Pickup counts and remaining rooms
 * always come from the server; pickup and release carry an Idempotency-Key
 * chosen when the dialog opens.
 */

type GroupArg = { propertyId: string; groupId: string };
type BlockArg<T> = { propertyId: string; blockId: string; body: T };

/** Block changes move inventory: availability, reservations and folio lists may change. */
const GROUPS = ["Group", "Block", "Availability", "Reservation"] as const;

export const groupsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    groupOptions: build.query<GroupOptions, string>({
      query: (propertyId) => `/properties/${propertyId}/groups/options`,
      transformResponse: (response: ApiSuccess<GroupOptions>) => response.data,
      keepUnusedDataFor: 300,
    }),
    groups: build.query<
      { items: GroupListItem[]; meta: CursorPageMeta },
      { propertyId: string; status?: string; q?: string; cursor?: string }
    >({
      query: ({ propertyId, ...params }) => {
        const search = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
        return `/properties/${propertyId}/groups?${search.toString()}`;
      },
      transformResponse: (response: ApiSuccess<GroupListItem[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: ["Group"],
    }),
    group: build.query<GroupDetail, GroupArg>({
      query: ({ propertyId, groupId }) => `/properties/${propertyId}/groups/${groupId}`,
      transformResponse: (response: ApiSuccess<GroupDetail>) => response.data,
      providesTags: (_r, _e, { groupId }) => [{ type: "Group", id: groupId }, "Block"],
    }),
    createGroup: build.mutation<GroupDetail, { propertyId: string; body: CreateGroupInput }>({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/groups`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<GroupDetail>) => response.data,
      invalidatesTags: [...GROUPS],
    }),
    updateGroup: build.mutation<GroupDetail, GroupArg & { body: UpdateGroupInput }>({
      query: ({ propertyId, groupId, body }) => ({
        url: `/properties/${propertyId}/groups/${groupId}`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<GroupDetail>) => response.data,
      invalidatesTags: [...GROUPS],
    }),
    changeGroupStatus: build.mutation<GroupDetail, GroupArg & { body: GroupStatusInput }>({
      query: ({ propertyId, groupId, body }) => ({
        url: `/properties/${propertyId}/groups/${groupId}/status`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<GroupDetail>) => response.data,
      invalidatesTags: [...GROUPS],
    }),
    createBlock: build.mutation<GroupDetail, GroupArg & { body: CreateBlockInput }>({
      query: ({ propertyId, groupId, body }) => ({
        url: `/properties/${propertyId}/groups/${groupId}/blocks`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<GroupDetail>) => response.data,
      invalidatesTags: [...GROUPS],
    }),
    setAllocation: build.mutation<GroupDetail, BlockArg<AllocationInput>>({
      query: ({ propertyId, blockId, body }) => ({
        url: `/properties/${propertyId}/blocks/${blockId}/allocation`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<GroupDetail>) => response.data,
      invalidatesTags: [...GROUPS],
    }),
    changeBlockStatus: build.mutation<GroupDetail, BlockArg<BlockStatusInput>>({
      query: ({ propertyId, blockId, body }) => ({
        url: `/properties/${propertyId}/blocks/${blockId}/status`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<GroupDetail>) => response.data,
      invalidatesTags: [...GROUPS],
    }),
    releaseBlock: build.mutation<
      ReleaseResult,
      BlockArg<ReleaseInput> & { idempotencyKey: string }
    >({
      query: ({ propertyId, blockId, body, idempotencyKey }) => ({
        url: `/properties/${propertyId}/blocks/${blockId}/release`,
        method: "POST",
        body,
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      transformResponse: (response: ApiSuccess<ReleaseResult>) => response.data,
      invalidatesTags: [...GROUPS],
    }),
    pickup: build.mutation<PickupResult, BlockArg<PickupInput> & { idempotencyKey: string }>({
      query: ({ propertyId, blockId, body, idempotencyKey }) => ({
        url: `/properties/${propertyId}/blocks/${blockId}/pickups`,
        method: "POST",
        body,
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      transformResponse: (response: ApiSuccess<PickupResult>) => response.data,
      invalidatesTags: [...GROUPS],
    }),
  }),
});

export const {
  useGroupOptionsQuery,
  useGroupsQuery,
  useGroupQuery,
  useCreateGroupMutation,
  useUpdateGroupMutation,
  useChangeGroupStatusMutation,
  useCreateBlockMutation,
  useSetAllocationMutation,
  useChangeBlockStatusMutation,
  useReleaseBlockMutation,
  usePickupMutation,
} = groupsApi;
