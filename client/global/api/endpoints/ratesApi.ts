import { API } from "@/global/constants/api";
import type {
  ApiSuccess,
  CreatePackageInput,
  CreateRatePlanInput,
  PackageView,
  RateAdminOptions,
  RateCalendarView,
  RatePlanAccountsInput,
  RatePlanDetail,
  RatePlanListItem,
  RatePlanPackagesInput,
  SeasonInput,
  SetRestrictionsInput,
  UpdatePackageInput,
  UpdateRatePlanInput,
} from "../types";
import { baseApi } from "../baseApi";
import { optionsTag } from "./optionsTags";

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
      query: (propertyId) => API.rates.ratesOptions(propertyId),
      transformResponse: (response: ApiSuccess<RateAdminOptions>) => response.data,
      providesTags: ["RatePlan"],
    }),
    ratePlans: build.query<RatePlanListItem[], string>({
      query: (propertyId) => API.rates.ratePlans(propertyId),
      transformResponse: (response: ApiSuccess<RatePlanListItem[]>) => response.data,
      providesTags: ["RatePlan"],
    }),
    ratePlan: build.query<RatePlanDetail, PlanArg>({
      query: ({ propertyId, ratePlanId }) => API.rates.ratePlan(propertyId, ratePlanId),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      providesTags: ["RatePlan"],
    }),
    rateCalendar: build.query<
      RateCalendarView,
      { propertyId: string; ratePlanId: string; roomTypeId: string; from: string; to: string }
    >({
      query: ({ propertyId, ...params }) =>
        `${API.rates.ratesCalendar(propertyId)}?${new URLSearchParams(params).toString()}`,
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
        return `${API.rates.restrictions(propertyId)}?${search.toString()}`;
      },
      transformResponse: (response: ApiSuccess<RestrictionRow[]>) => response.data,
      providesTags: ["Availability"],
    }),
    packages: build.query<PackageView[], string>({
      query: (propertyId) => API.rates.packages(propertyId),
      transformResponse: (response: ApiSuccess<PackageView[]>) => response.data,
      providesTags: ["RatePlan"],
    }),

    createRatePlan: build.mutation<
      RatePlanDetail,
      { propertyId: string; body: CreateRatePlanInput }
    >({
      query: ({ propertyId, body }) => ({
        url: API.rates.ratePlans(propertyId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => [...RATES, optionsTag(propertyId)],
    }),
    updateRatePlan: build.mutation<RatePlanDetail, PlanArg & { body: UpdateRatePlanInput }>({
      query: ({ propertyId, ratePlanId, body }) => ({
        url: API.rates.ratePlan(propertyId, ratePlanId),
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => [...RATES, optionsTag(propertyId)],
    }),
    saveSeason: build.mutation<RatePlanDetail, PlanArg & { seasonId?: string; body: SeasonInput }>({
      query: ({ propertyId, ratePlanId, seasonId, body }) => ({
        url: seasonId
          ? API.rates.ratePlanSeason(propertyId, ratePlanId, seasonId)
          : API.rates.ratePlanSeasons(propertyId, ratePlanId),
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
        url: API.rates.ratePlanSeason(propertyId, ratePlanId, seasonId),
        method: "DELETE",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: [...RATES],
    }),
    setPlanPackages: build.mutation<RatePlanDetail, PlanArg & { body: RatePlanPackagesInput }>({
      query: ({ propertyId, ratePlanId, body }) => ({
        url: API.rates.ratePlanPackages(propertyId, ratePlanId),
        method: "PUT",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: [...RATES],
    }),
    /** Companies a negotiated plan is sold to (Phase 7). */
    setPlanAccounts: build.mutation<RatePlanDetail, PlanArg & { body: RatePlanAccountsInput }>({
      query: ({ propertyId, ratePlanId, body }) => ({
        url: API.rates.ratePlanAccounts(propertyId, ratePlanId),
        method: "PUT",
        body,
      }),
      transformResponse: (response: ApiSuccess<RatePlanDetail>) => response.data,
      invalidatesTags: [...RATES, "Account"],
    }),
    setRestrictions: build.mutation<
      { days: string[]; action: string; changed: number },
      { propertyId: string; body: SetRestrictionsInput }
    >({
      query: ({ propertyId, body }) => ({
        url: API.rates.restrictions(propertyId),
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
        url: packageId ? API.rates.package(propertyId, packageId) : API.rates.packages(propertyId),
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
  useSetPlanAccountsMutation,
  useSetRestrictionsMutation,
  useSavePackageMutation,
} = ratesApi;
