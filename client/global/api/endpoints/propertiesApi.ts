import { API } from "@/global/constants/api";
import type { ApiSuccess, BusinessDateView } from "../types";
import { baseApi } from "../baseApi";

/** Property context endpoints used by the workspace shell and property pages. */
export const propertiesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    businessDate: build.query<BusinessDateView, string>({
      query: (propertyId) => API.properties.businessDate(propertyId),
      transformResponse: (response: ApiSuccess<BusinessDateView>) => response.data,
      providesTags: (_result, _error, propertyId) => [{ type: "BusinessDate", id: propertyId }],
    }),
  }),
});

export const { useBusinessDateQuery } = propertiesApi;
