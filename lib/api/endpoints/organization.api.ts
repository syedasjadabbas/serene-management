import type { OrganizationAuditLogQuery } from "@/modules/audit/audit.schema";
import type { OrganizationAuditLogView } from "@/modules/audit/audit.types";
import type {
  CentralAvailabilityResult,
  OrganizationOverview,
  OrganizationPerformanceReport,
} from "@/modules/organization/organization.types";
import type { PropertySetupCopyResult, PropertyView } from "@/modules/properties/properties.types";
import type { PasswordResetIssued, RoleView, UserView } from "@/modules/users/users.types";
import type { ApiSuccess, CursorPageMeta, OffsetPageMeta } from "@/types/api";
import { baseApi } from "../baseApi";

/**
 * Organization workspace (Phase 9): overview, reports, central availability,
 * audit trail, users and properties. Every response is limited by the server
 * to the properties and scopes the caller may use.
 */

function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface CentralAvailabilityArgs {
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  rooms: number;
}

export const organizationApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    organizationOverview: build.query<OrganizationOverview, void>({
      query: () => "/organization/overview",
      transformResponse: (response: ApiSuccess<OrganizationOverview>) => response.data,
      providesTags: ["Report", "Property"],
    }),
    organizationPerformance: build.query<
      OrganizationPerformanceReport,
      { from: string; to: string }
    >({
      query: (args) => `/organization/reports/performance${qs(args)}`,
      transformResponse: (response: ApiSuccess<OrganizationPerformanceReport>) => response.data,
      providesTags: ["Report"],
    }),
    centralAvailability: build.query<CentralAvailabilityResult, CentralAvailabilityArgs>({
      query: (args) => `/availability${qs({ ...args })}`,
      transformResponse: (response: ApiSuccess<CentralAvailabilityResult>) => response.data,
      providesTags: ["Availability"],
    }),
    organizationAuditLogs: build.query<
      { items: OrganizationAuditLogView[]; meta: CursorPageMeta },
      Partial<OrganizationAuditLogQuery>
    >({
      query: (args) => `/audit-logs${qs({ ...args })}`,
      transformResponse: (response: ApiSuccess<OrganizationAuditLogView[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta!,
      }),
      providesTags: ["AuditLog"],
    }),
    users: build.query<
      { items: UserView[]; meta: OffsetPageMeta },
      { page: number; pageSize: number; q?: string }
    >({
      query: (args) => `/users${qs(args)}`,
      transformResponse: (response: ApiSuccess<UserView[], OffsetPageMeta>) => ({
        items: response.data,
        meta: response.meta!,
      }),
      providesTags: ["User"],
    }),
    roles: build.query<RoleView[], void>({
      query: () => "/roles",
      transformResponse: (response: ApiSuccess<RoleView[]>) => response.data,
      providesTags: ["Role"],
    }),
    grantRole: build.mutation<
      UserView,
      {
        userId: string;
        body:
          | { scope: "ORGANIZATION"; roleId: string; reason: string }
          | { scope: "PROPERTY"; roleId: string; propertyId: string; reason: string };
      }
    >({
      query: ({ userId, body }) => ({
        url: `/users/${userId}/role-assignments`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<UserView>) => response.data,
      invalidatesTags: ["User", "AuditLog"],
    }),
    revokeRole: build.mutation<UserView, { userId: string; assignmentId: string; reason: string }>({
      query: ({ userId, assignmentId, reason }) => ({
        url: `/users/${userId}/role-assignments/${assignmentId}`,
        method: "DELETE",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<UserView>) => response.data,
      invalidatesTags: ["User", "AuditLog"],
    }),
    userStatus: build.mutation<
      UserView,
      { userId: string; action: "disable" | "unlock" | "enable"; reason: string }
    >({
      query: ({ userId, action, reason }) => ({
        url: `/users/${userId}/${action}`,
        method: "POST",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<UserView>) => response.data,
      invalidatesTags: ["User", "AuditLog"],
    }),
    issuePasswordReset: build.mutation<PasswordResetIssued, { userId: string; reason: string }>({
      query: ({ userId, reason }) => ({
        url: `/users/${userId}/password-reset`,
        method: "POST",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<PasswordResetIssued>) => response.data,
      invalidatesTags: ["User", "AuditLog"],
    }),
    accessibleProperties: build.query<PropertyView[], void>({
      query: () => "/properties",
      transformResponse: (response: ApiSuccess<PropertyView[]>) => response.data,
      providesTags: ["Property"],
    }),
    createProperty: build.mutation<
      PropertyView,
      {
        code: string;
        name: string;
        timezone: string;
        currencyCode: string;
        countryCode: string;
        confirmationPrefix?: string;
        reason: string;
      }
    >({
      query: (body) => ({ url: "/properties", method: "POST", body }),
      transformResponse: (response: ApiSuccess<PropertyView>) => response.data,
      invalidatesTags: ["Property", "Me", "AuditLog"],
    }),
    copyPropertySetup: build.mutation<
      PropertySetupCopyResult,
      { targetId: string; sourceId: string; reason: string }
    >({
      query: ({ targetId, sourceId, reason }) => ({
        url: `/properties/${targetId}/setup/copy-from/${sourceId}`,
        method: "POST",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<PropertySetupCopyResult>) => response.data,
      invalidatesTags: ["Property", "AuditLog"],
    }),
  }),
});

export const {
  useOrganizationOverviewQuery,
  useOrganizationPerformanceQuery,
  useCentralAvailabilityQuery,
  useOrganizationAuditLogsQuery,
  useUsersQuery,
  useRolesQuery,
  useGrantRoleMutation,
  useRevokeRoleMutation,
  useUserStatusMutation,
  useIssuePasswordResetMutation,
  useAccessiblePropertiesQuery,
  useCreatePropertyMutation,
  useCopyPropertySetupMutation,
} = organizationApi;
