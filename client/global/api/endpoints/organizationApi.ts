import { API } from "@/global/constants/api";
import type {
  ApiSuccess,
  CentralAvailabilityResult,
  CursorPageMeta,
  InviteUserInput,
  OffsetPageMeta,
  OrganizationAuditLogQuery,
  OrganizationAuditLogView,
  OrganizationOverview,
  OrganizationPerformanceReport,
  PasswordResetIssued,
  PropertySetupCopyResult,
  PropertyView,
  RoleView,
  UserInvited,
  UserView,
} from "../types";
import { baseApi } from "../baseApi";
import { assigneeOptionsTag, optionsTag } from "./optionsTags";

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
      query: () => API.organization.organizationOverview(),
      transformResponse: (response: ApiSuccess<OrganizationOverview>) => response.data,
      providesTags: ["Report", "Property"],
    }),
    organizationPerformance: build.query<
      OrganizationPerformanceReport,
      { from: string; to: string }
    >({
      query: (args) => `${API.organization.organizationReportsPerformance()}${qs(args)}`,
      transformResponse: (response: ApiSuccess<OrganizationPerformanceReport>) => response.data,
      providesTags: ["Report"],
    }),
    centralAvailability: build.query<CentralAvailabilityResult, CentralAvailabilityArgs>({
      query: (args) => `${API.organization.availability()}${qs({ ...args })}`,
      transformResponse: (response: ApiSuccess<CentralAvailabilityResult>) => response.data,
      providesTags: ["Availability"],
    }),
    organizationAuditLogs: build.query<
      { items: OrganizationAuditLogView[]; meta: CursorPageMeta },
      Partial<OrganizationAuditLogQuery>
    >({
      query: (args) => `${API.organization.auditLogs()}${qs({ ...args })}`,
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
      query: (args) => `${API.organization.users()}${qs(args)}`,
      transformResponse: (response: ApiSuccess<UserView[], OffsetPageMeta>) => ({
        items: response.data,
        meta: response.meta!,
      }),
      providesTags: ["User"],
    }),
    roles: build.query<RoleView[], void>({
      query: () => API.organization.roles(),
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
        url: API.organization.userRoleAssignments(userId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<UserView>) => response.data,
      invalidatesTags: ["User", "AuditLog", assigneeOptionsTag()],
    }),
    revokeRole: build.mutation<UserView, { userId: string; assignmentId: string; reason: string }>({
      query: ({ userId, assignmentId, reason }) => ({
        url: API.organization.userRoleAssignment(userId, assignmentId),
        method: "DELETE",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<UserView>) => response.data,
      invalidatesTags: ["User", "AuditLog", assigneeOptionsTag()],
    }),
    userStatus: build.mutation<
      UserView,
      { userId: string; action: "disable" | "unlock" | "enable"; reason: string }
    >({
      query: ({ userId, action, reason }) => ({
        url: API.organization.userAction(userId, action),
        method: "POST",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<UserView>) => response.data,
      invalidatesTags: ["User", "AuditLog", assigneeOptionsTag()],
    }),
    /** Adds an INVITED user with a first role; returns the one-time set-password link. */
    inviteUser: build.mutation<UserInvited, InviteUserInput>({
      query: (body) => ({ url: API.organization.users(), method: "POST", body }),
      transformResponse: (response: ApiSuccess<UserInvited>) => response.data,
      invalidatesTags: ["User", "AuditLog", assigneeOptionsTag()],
    }),
    issuePasswordReset: build.mutation<PasswordResetIssued, { userId: string; reason: string }>({
      query: ({ userId, reason }) => ({
        url: API.organization.userPasswordReset(userId),
        method: "POST",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<PasswordResetIssued>) => response.data,
      invalidatesTags: ["User", "AuditLog"],
    }),
    accessibleProperties: build.query<PropertyView[], void>({
      query: () => API.organization.properties(),
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
      query: (body) => ({ url: API.organization.properties(), method: "POST", body }),
      transformResponse: (response: ApiSuccess<PropertyView>) => response.data,
      invalidatesTags: (result) => [
        "Property",
        "Me",
        "AuditLog",
        ...(result ? [optionsTag(result.id)] : []),
      ],
    }),
    copyPropertySetup: build.mutation<
      PropertySetupCopyResult,
      { targetId: string; sourceId: string; reason: string }
    >({
      query: ({ targetId, sourceId, reason }) => ({
        url: API.organization.setupCopyFrom(targetId, sourceId),
        method: "POST",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<PropertySetupCopyResult>) => response.data,
      invalidatesTags: (_r, _e, { targetId }) => ["Property", "AuditLog", optionsTag(targetId)],
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
  useInviteUserMutation,
  useAccessiblePropertiesQuery,
  useCreatePropertyMutation,
  useCopyPropertySetupMutation,
} = organizationApi;
