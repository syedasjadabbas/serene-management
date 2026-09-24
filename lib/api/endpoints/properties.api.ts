import type { BusinessDateView } from "@/modules/business-date/business-date.types";
import type { ApiSuccess } from "@/types/api";
import { baseApi } from "../baseApi";

/** Property context endpoints used by the workspace shell and property pages. */
export const propertiesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    businessDate: build.query<BusinessDateView, string>({
      query: (propertyId) => `/properties/${propertyId}/business-date`,
      transformResponse: (response: ApiSuccess<BusinessDateView>) => response.data,
      providesTags: (_result, _error, propertyId) => [{ type: "BusinessDate", id: propertyId }],
    }),
  }),
});

export const { useBusinessDateQuery } = propertiesApi;
