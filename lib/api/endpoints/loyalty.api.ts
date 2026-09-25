import { baseApi } from "../baseApi";
import type {
  ChangeMembershipInput,
  CreateProgramInput,
  CreateTierInput,
  PointsAdjustmentInput,
  UpdateProgramInput,
  UpdateTierInput,
} from "@/modules/loyalty/loyalty.schema";
import type { LoyaltyMemberRow, LoyaltyOverview } from "@/modules/loyalty/loyalty.types";
import type { GuestProfileView } from "@/modules/guests/guests.types";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";

/** Loyalty programs, tiers and memberships (Phase 7 foundation). */
export const loyaltyApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    loyaltyOverview: build.query<LoyaltyOverview, void>({
      query: () => "/loyalty/programs",
      transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
      providesTags: ["Loyalty"],
    }),
    loyaltyMembers: build.query<
      { items: LoyaltyMemberRow[]; meta: CursorPageMeta },
      { programId: string; cursor?: string }
    >({
      query: ({ programId, cursor }) =>
        `/loyalty/programs/${programId}/members${cursor ? `?cursor=${cursor}` : ""}`,
      transformResponse: (response: ApiSuccess<LoyaltyMemberRow[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: ["Loyalty"],
    }),
    createProgram: build.mutation<LoyaltyOverview, CreateProgramInput>({
      query: (body) => ({ url: "/loyalty/programs", method: "POST", body }),
      transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
      invalidatesTags: ["Loyalty"],
    }),
    updateProgram: build.mutation<LoyaltyOverview, { programId: string; body: UpdateProgramInput }>(
      {
        query: ({ programId, body }) => ({
          url: `/loyalty/programs/${programId}`,
          method: "PATCH",
          body,
        }),
        transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
        invalidatesTags: ["Loyalty"],
      },
    ),
    createTier: build.mutation<LoyaltyOverview, { programId: string; body: CreateTierInput }>({
      query: ({ programId, body }) => ({
        url: `/loyalty/programs/${programId}/tiers`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
      invalidatesTags: ["Loyalty"],
    }),
    updateTier: build.mutation<LoyaltyOverview, { tierId: string; body: UpdateTierInput }>({
      query: ({ tierId, body }) => ({ url: `/loyalty/tiers/${tierId}`, method: "PATCH", body }),
      transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
      invalidatesTags: ["Loyalty"],
    }),
    changeMembership: build.mutation<
      GuestProfileView,
      { membershipId: string; guestId: string; body: ChangeMembershipInput }
    >({
      query: ({ membershipId, body }) => ({
        url: `/loyalty/memberships/${membershipId}`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<GuestProfileView>) => response.data,
      invalidatesTags: (_r, _e, { guestId }) => [{ type: "Guest", id: guestId }, "Loyalty"],
    }),
    adjustPoints: build.mutation<
      GuestProfileView,
      { membershipId: string; guestId: string; body: PointsAdjustmentInput }
    >({
      query: ({ membershipId, body }) => ({
        url: `/loyalty/memberships/${membershipId}/adjustments`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<GuestProfileView>) => response.data,
      invalidatesTags: (_r, _e, { guestId }) => [{ type: "Guest", id: guestId }, "Loyalty"],
    }),
  }),
});

export const {
  useLoyaltyOverviewQuery,
  useLoyaltyMembersQuery,
  useCreateProgramMutation,
  useUpdateProgramMutation,
  useCreateTierMutation,
  useUpdateTierMutation,
  useChangeMembershipMutation,
  useAdjustPointsMutation,
} = loyaltyApi;
