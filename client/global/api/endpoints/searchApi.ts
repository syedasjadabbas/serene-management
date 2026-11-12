import { API } from "@/global/constants/api";
import type { ApiSuccess, GlobalSearchResult } from "../types";
import { baseApi } from "../baseApi";

/**
 * Global search (docs/SCALABILITY.md §28): one request per debounced query.
 * The server runs every search the user may use (permissions, property and
 * organization scope are checked there, per type) and returns normalized
 * groups. Results carry a type, a property code and a record id, never a
 * URL: the palette builds the route itself (search.policy).
 */

export interface GlobalSearchArgs {
  q: string;
  /** The current property; null in the organization workspace. */
  propertyId: string | null;
}

export const searchApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    globalSearch: build.query<GlobalSearchResult, GlobalSearchArgs>({
      query: ({ q, propertyId }) => {
        const params = new URLSearchParams({ q }).toString();
        return propertyId
          ? `${API.search.propertySearch(propertyId)}?${params}`
          : `${API.search.organizationSearch()}?${params}`;
      },
      transformResponse: (response: ApiSuccess<GlobalSearchResult>) => response.data,
      keepUnusedDataFor: 30,
    }),
  }),
});

export const { useLazyGlobalSearchQuery } = searchApi;
