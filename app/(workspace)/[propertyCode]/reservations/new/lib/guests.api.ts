import { baseApi } from "@/lib/api/baseApi";
import type { CreateGuestInput } from "@/modules/guests/guests.schema";
import type { GuestSummaryView } from "@/modules/guests/guests.types";
import type { ApiSuccess } from "@/types/api";

/** Guest lookup for the booking workflow (organization-wide profiles). */
export const bookingGuestsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    searchGuests: build.query<GuestSummaryView[], string>({
      query: (q) => `/guests?${new URLSearchParams({ q, limit: "10" }).toString()}`,
      transformResponse: (response: ApiSuccess<GuestSummaryView[]>) => response.data,
      providesTags: [{ type: "Guest", id: "SEARCH" }],
    }),
    createGuest: build.mutation<GuestSummaryView, Partial<CreateGuestInput>>({
      query: (body) => ({ url: "/guests", method: "POST", body }),
      transformResponse: (response: ApiSuccess<GuestSummaryView>) => response.data,
      invalidatesTags: [{ type: "Guest", id: "SEARCH" }],
    }),
  }),
});

export const { useSearchGuestsQuery, useCreateGuestMutation } = bookingGuestsApi;
