import { API } from "@/global/constants/api";
import type {
  ApiSuccess,
  ChangeMembershipInput,
  CreateProgramInput,
  CreateTierInput,
  CursorPageMeta,
  GuestProfileView,
  LoyaltyMemberRow,
  LoyaltyOverview,
  PointsAdjustmentInput,
  UpdateProgramInput,
  UpdateTierInput,
} from "../types";
import { baseApi } from "../baseApi";

/** Loyalty programs, tiers and memberships (Phase 7 foundation). */
export const loyaltyApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    loyaltyOverview: build.query<LoyaltyOverview, void>({
      query: () => API.loyalty.loyaltyPrograms(),
      transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
      providesTags: ["Loyalty"],
    }),
    loyaltyMembers: build.query<
      { items: LoyaltyMemberRow[]; meta: CursorPageMeta },
      { programId: string; cursor?: string }
    >({
      query: ({ programId, cursor }) =>
        `${API.loyalty.loyaltyProgramMembers(programId)}${cursor ? `?cursor=${cursor}` : ""}`,
      transformResponse: (response: ApiSuccess<LoyaltyMemberRow[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: ["Loyalty"],
    }),
    createProgram: build.mutation<LoyaltyOverview, CreateProgramInput>({
      query: (body) => ({ url: API.loyalty.loyaltyPrograms(), method: "POST", body }),
      transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
      invalidatesTags: ["Loyalty"],
    }),
    updateProgram: build.mutation<LoyaltyOverview, { programId: string; body: UpdateProgramInput }>(
      {
        query: ({ programId, body }) => ({
          url: API.loyalty.loyaltyProgram(programId),
          method: "PATCH",
          body,
        }),
        transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
        invalidatesTags: ["Loyalty"],
      },
    ),
    createTier: build.mutation<LoyaltyOverview, { programId: string; body: CreateTierInput }>({
      query: ({ programId, body }) => ({
        url: API.loyalty.loyaltyProgramTiers(programId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
      invalidatesTags: ["Loyalty"],
    }),
    updateTier: build.mutation<LoyaltyOverview, { tierId: string; body: UpdateTierInput }>({
      query: ({ tierId, body }) => ({
        url: API.loyalty.loyaltyTier(tierId),
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<LoyaltyOverview>) => response.data,
      invalidatesTags: ["Loyalty"],
    }),
    changeMembership: build.mutation<
      GuestProfileView,
      { membershipId: string; guestId: string; body: ChangeMembershipInput }
    >({
      query: ({ membershipId, body }) => ({
        url: API.loyalty.loyaltyMembership(membershipId),
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
        url: API.loyalty.loyaltyMembershipAdjustments(membershipId),
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
