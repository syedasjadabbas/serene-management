import { API } from "@/global/constants/api";
import type {
  ApiSuccess,
  DashboardView,
  ReportCatalogItem,
  ReportQuery,
  ReportResult,
} from "../types";
import { baseApi } from "../baseApi";

/** Reports and the property dashboard (Phase 8): read-only, refreshed after night audit. */

export function reportQueryString(query: ReportQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) search.set(key, String(value));
  return search.toString();
}

/** API path (relative to the base URL) of the CSV download; fetched with the Bearer header (DownloadButton). */
export function reportExportPath(
  propertyId: string,
  reportKey: string,
  query: ReportQuery,
): string {
  const qs = reportQueryString(query);
  return `${API.reports.reportExport(propertyId, reportKey)}${qs ? `?${qs}` : ""}`;
}

export const reportsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    reportCatalog: build.query<{ reports: ReportCatalogItem[]; canExport: boolean }, string>({
      query: (propertyId) => API.reports.reports(propertyId),
      transformResponse: (
        response: ApiSuccess<{ reports: ReportCatalogItem[]; canExport: boolean }>,
      ) => response.data,
      keepUnusedDataFor: 300,
    }),
    report: build.query<
      ReportResult,
      { propertyId: string; reportKey: string; query: ReportQuery }
    >({
      query: ({ propertyId, reportKey, query }) => {
        const qs = reportQueryString(query);
        return `${API.reports.report(propertyId, reportKey)}${qs ? `?${qs}` : ""}`;
      },
      transformResponse: (response: ApiSuccess<ReportResult>) => response.data,
      providesTags: ["Report"],
    }),
    dashboard: build.query<DashboardView, string>({
      query: (propertyId) => API.reports.dashboard(propertyId),
      transformResponse: (response: ApiSuccess<DashboardView>) => response.data,
      providesTags: ["Report"],
    }),
  }),
});

export const { useReportCatalogQuery, useReportQuery, useDashboardQuery } = reportsApi;
