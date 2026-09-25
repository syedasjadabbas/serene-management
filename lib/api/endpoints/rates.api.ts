import type {
  CreatePackageInput,
  CreateRatePlanInput,
  RatePlanPackagesInput,
  SeasonInput,
  UpdatePackageInput,
  UpdateRatePlanInput,
} from "@/modules/rates/rates.schema";
import type { SetRestrictionsInput } from "@/modules/availability/availability.schema";
import type {
  PackageView,
  RateAdminOptions,
  RateCalendarView,
  RatePlanDetail,
  RatePlanListItem,
} from "@/modules/rates/rates.types";
import type { ApiSuccess } from "@/types/api";
import { baseApi } from "../baseApi";

/**
 * Rate administration (Phase 6): rate plans, seasons, restrictions,
 * packages and the pricing calendar. Prices shown here are computed by the
 * server's pricing engine; the UI never calculates a rate.
 */

export interface RestrictionRow {
  id: string;
  stayDate: string;
  type: string;
  value: number | null;
  roomType: { id: string; code: string } | null;
  ratePlan: { id: string; code: string } | null;
}

type PlanArg = { propertyId: string; ratePlanId: string };

/** Rate or restriction changes alter quotes, availability and calendars. */
const RATES = ["RatePlan", "Availability"] as const;

export const ratesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    rateOptions: build.query<RateAdminOptions, string>({
      query: (propertyId) => `/properties/${propertyId}/rates/options`,
      transformResponse: (response: ApiSuccess<RateAdminOptions>) => response.data,
      providesTags: ["RatePlan"],
    }),
    ratePlans: build.query<RatePlanListItem[], string>({
      query: (propertyId) => `/properties/${propertyId}/rate-plans`,
      transformResponse: (response: ApiSuccess<RatePlanListItem[]>) => response.data,
      providesTags: ["RatePlan"],
    }),
    ratePlan: build.query<RatePlanDetail, PlanArg>({
      query: ({ propertyId, ratePlanId }) => `/properties/${propertyId}/rate-plans/${ratePlanId}`,
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      providesTags: ["RatePlan"],
    }),
    rateCalendar: build.query<
      RateCalendarView,
      { propertyId: string; ratePlanId: string; roomTypeId: string; from: string; to: string }
    >({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/rates/calendar?${new URLSearchParams(params).toString()}`,
      transformResponse: (response: ApiSuccess<RateCalendarView>) => response.data,
      providesTags: ["RatePlan", "Availability"],
    }),
    restrictions: build.query<
      RestrictionRow[],
      { propertyId: string; from: string; to: string; roomTypeId?: string; ratePlanId?: string }
    >({
      query: ({ propertyId, ...params }) => {
        const search = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
        return `/properties/${propertyId}/restrictions?${search.toString()}`;
      },
      transformResponse: (response: ApiSuccess<RestrictionRow[]>) => response.data,
      providesTags: ["Availability"],
    }),
    packages: build.query<PackageView[], string>({
      query: (propertyId) => `/properties/${propertyId}/packages`,
      transformResponse: (response: ApiSuccess<PackageView[]>) => response.data,
      providesTags: ["RatePlan"],
    }),

    createRatePlan: build.mutation<
      RatePlanDetail,
      { propertyId: string; body: CreateRatePlanInput }
    >({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/rate-plans`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: [...RATES],
    }),
    updateRatePlan: build.mutation<RatePlanDetail, PlanArg & { body: UpdateRatePlanInput }>({
      query: ({ propertyId, ratePlanId, body }) => ({
        url: `/properties/${propertyId}/rate-plans/${ratePlanId}`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: [...RATES],
    }),
    saveSeason: build.mutation<RatePlanDetail, PlanArg & { seasonId?: string; body: SeasonInput }>({
      query: ({ propertyId, ratePlanId, seasonId, body }) => ({
        url: `/properties/${propertyId}/rate-plans/${ratePlanId}/seasons${seasonId ? `/${seasonId}` : ""}`,
        method: seasonId ? "PATCH" : "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: [...RATES],
    }),
    deleteSeason: build.mutation<
      RatePlanDetail,
      PlanArg & { seasonId: string; body: { version: number; reason: string } }
    >({
      query: ({ propertyId, ratePlanId, seasonId, body }) => ({
        url: `/properties/${propertyId}/rate-plans/${ratePlanId}/seasons/${seasonId}`,
        method: "DELETE",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: [...RATES],
    }),
    setPlanPackages: build.mutation<RatePlanDetail, PlanArg & { body: RatePlanPackagesInput }>({
      query: ({ propertyId, ratePlanId, body }) => ({
        url: `/properties/${propertyId}/rate-plans/${ratePlanId}/packages`,
        method: "PUT",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: [...RATES],
    }),
    setRestrictions: build.mutation<
      { days: string[]; action: string; changed: number },
      { propertyId: string; body: SetRestrictionsInput }
    >({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/restrictions`,
        method: "POST",
        body,
      }),
      transformResponse: (
        response: ApiSuccess<{ days: string[]; action: string; changed: number }>,
      ) => response.data,
      invalidatesTags: [...RATES],
    }),
    savePackage: build.mutation<
      PackageView,
      { propertyId: string; packageId?: string; body: CreatePackageInput | UpdatePackageInput }
    >({
      query: ({ propertyId, packageId, body }) => ({
        url: `/properties/${propertyId}/packages${packageId ? `/${packageId}` : ""}`,
        method: packageId ? "PATCH" : "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<PackageView>) => response.data,
      invalidatesTags: [...RATES, "Reservation"],
    }),
  }),
});

export const {
  useRateOptionsQuery,
  useRatePlansQuery,
  useRatePlanQuery,
  useRateCalendarQuery,
  useRestrictionsQuery,
  usePackagesQuery,
  useCreateRatePlanMutation,
  useUpdateRatePlanMutation,
  useSaveSeasonMutation,
  useDeleteSeasonMutation,
  useSetPlanPackagesMutation,
  useSetRestrictionsMutation,
  useSavePackageMutation,
} = ratesApi;
