import { baseApi } from "../baseApi";
import type {
  CreateGuestInput,
  CreateGuestNoteInput,
  GuestPreferencesInput,
  UpdateGuestInput,
} from "@/modules/guests/guests.schema";
import type {
  GuestHistoryRow,
  GuestOptions,
  GuestProfileView,
  GuestSummaryView,
} from "@/modules/guests/guests.types";
import type { EnrollInput } from "@/modules/loyalty/loyalty.schema";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";

/**
 * Guest profiles (organization data, Phase 7). Search is server-side and
 * debounced by callers; profile commands carry the profile `version`.
 */

type HistoryMeta = CursorPageMeta & { properties: { id: string; code: string; name: string }[] };

export const bookingGuestsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** Picker search (booking, pickups, relationships): first page only. */
    searchGuests: build.query<GuestSummaryView[], string>({
      query: (q) => `/guests?${new URLSearchParams({ q, limit: "10" }).toString()}`,
      transformResponse: (response: ApiSuccess<GuestSummaryView[]>) => response.data,
      providesTags: [{ type: "Guest", id: "SEARCH" }],
    }),
    /** Guest workspace list / search, keyset-paginated. */
    guestList: build.query<
      { items: GuestSummaryView[]; meta: CursorPageMeta },
      { q?: string; status?: string; cursor?: string; limit?: number }
    >({
      query: (params) => {
        const search = new URLSearchParams();
        for (const [k, v] of Object.entries(params))
          if (v !== undefined && v !== "") search.set(k, String(v));
        return `/guests?${search.toString()}`;
      },
      transformResponse: (response: ApiSuccess<GuestSummaryView[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: [{ type: "Guest", id: "SEARCH" }],
    }),
    createGuest: build.mutation<GuestSummaryView, Partial<CreateGuestInput>>({
      query: (body) => ({ url: "/guests", method: "POST", body }),
      transformResponse: (response: ApiSuccess<GuestSummaryView>) => response.data,
      invalidatesTags: [{ type: "Guest", id: "SEARCH" }],
    }),
    guestOptions: build.query<GuestOptions, void>({
      query: () => "/guests/options",
      transformResponse: (response: ApiSuccess<GuestOptions>) => response.data,
      keepUnusedDataFor: 300,
    }),
    guest: build.query<GuestProfileView, string>({
      query: (guestId) => `/guests/${guestId}`,
      transformResponse: (response: ApiSuccess<GuestProfileView>) => response.data,
      providesTags: (_r, _e, guestId) => [{ type: "Guest", id: guestId }],
    }),
    guestHistory: build.query<
      { items: GuestHistoryRow[]; meta: HistoryMeta },
      { guestId: string; propertyId?: string; status?: string; cursor?: string }
    >({
      query: ({ guestId, ...params }) => {
        const search = new URLSearchParams({ limit: "20" });
        for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
        return `/guests/${guestId}/history?${search.toString()}`;
      },
      transformResponse: (response: ApiSuccess<GuestHistoryRow[], HistoryMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0, properties: [] },
      }),
      providesTags: (_r, _e, { guestId }) => [{ type: "Guest", id: guestId }, "Reservation"],
    }),
    updateGuest: build.mutation<
      GuestProfileView,
      { guestId: string; body: Partial<UpdateGuestInput> }
    >({
      query: ({ guestId, body }) => ({ url: `/guests/${guestId}`, method: "PATCH", body }),
      transformResponse: (response: ApiSuccess<GuestProfileView>) => response.data,
      invalidatesTags: (_r, _e, { guestId }) => [
        { type: "Guest", id: guestId },
        { type: "Guest", id: "SEARCH" },
        "Reservation",
      ],
    }),
    setGuestPreferences: build.mutation<
      GuestProfileView,
      { guestId: string; body: GuestPreferencesInput }
    >({
      query: ({ guestId, body }) => ({
        url: `/guests/${guestId}/preferences`,
        method: "PUT",
        body,
      }),
      transformResponse: (response: ApiSuccess<GuestProfileView>) => response.data,
      invalidatesTags: (_r, _e, { guestId }) => [{ type: "Guest", id: guestId }],
    }),
    addGuestNote: build.mutation<
      GuestProfileView,
      { guestId: string; body: Partial<CreateGuestNoteInput> }
    >({
      query: ({ guestId, body }) => ({ url: `/guests/${guestId}/notes`, method: "POST", body }),
      transformResponse: (response: ApiSuccess<GuestProfileView>) => response.data,
      invalidatesTags: (_r, _e, { guestId }) => [{ type: "Guest", id: guestId }],
    }),
    deleteGuestNote: build.mutation<GuestProfileView, { guestId: string; noteId: string }>({
      query: ({ guestId, noteId }) => ({
        url: `/guests/${guestId}/notes/${noteId}`,
        method: "DELETE",
      }),
      transformResponse: (response: ApiSuccess<GuestProfileView>) => response.data,
      invalidatesTags: (_r, _e, { guestId }) => [{ type: "Guest", id: guestId }],
    }),
    enrollGuest: build.mutation<GuestProfileView, { guestId: string; body: EnrollInput }>({
      query: ({ guestId, body }) => ({ url: `/guests/${guestId}/loyalty`, method: "POST", body }),
      transformResponse: (response: ApiSuccess<GuestProfileView>) => response.data,
      invalidatesTags: (_r, _e, { guestId }) => [{ type: "Guest", id: guestId }, "Loyalty"],
    }),
  }),
});

export const {
  useSearchGuestsQuery,
  useGuestListQuery,
  useCreateGuestMutation,
  useGuestOptionsQuery,
  useGuestQuery,
  useGuestHistoryQuery,
  useUpdateGuestMutation,
  useSetGuestPreferencesMutation,
  useAddGuestNoteMutation,
  useDeleteGuestNoteMutation,
  useEnrollGuestMutation,
} = bookingGuestsApi;
