import { API } from "@/global/constants/api";
import type { ApiSuccess, CursorPageMeta, ReadinessView, RunListItem, RunView } from "../types";
import { baseApi } from "../baseApi";
import { optionsTag } from "./optionsTags";

/**
 * Night audit (Phase 8). Starting a run carries an Idempotency-Key chosen
 * when the dialog opens. The run executes in a background job (202 RUNNING);
 * the run page follows it, and when it finishes the business date has rolled
 * (or reopened), so every operational list and the business date itself are
 * refetched (NIGHT_AUDIT_ROLLED_TAGS) — at the start too, as the date is
 * then IN_AUDIT.
 */

/** The roll also changes the business date that group and billing options carry. */
export const nightAuditRolledTags = (propertyId: string) => [
  ...NIGHT_AUDIT_ROLLED_TAGS,
  optionsTag(propertyId),
];

export const NIGHT_AUDIT_ROLLED_TAGS = [
  "BusinessDate",
  "NightAudit",
  "Report",
  "Reservation",
  "Stay",
  "Folio",
  "Payment",
  "Room",
  "RoomStatus",
  "HousekeepingTask",
  "Availability",
  "Group",
  "Block",
  "AuditLog",
] as const;

export const nightAuditApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    nightAuditReadiness: build.query<ReadinessView, string>({
      query: (propertyId) => API.nightAudit.nightAuditsReadiness(propertyId),
      transformResponse: (response: ApiSuccess<ReadinessView>) => response.data,
      providesTags: ["NightAudit"],
    }),
    nightAuditRuns: build.query<
      { items: RunListItem[]; meta: CursorPageMeta },
      { propertyId: string; cursor?: string }
    >({
      query: ({ propertyId, cursor }) =>
        `${API.nightAudit.nightAudits(propertyId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      transformResponse: (response: ApiSuccess<RunListItem[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: ["NightAudit"],
    }),
    nightAuditRun: build.query<RunView, { propertyId: string; runId: string }>({
      query: ({ propertyId, runId }) => API.nightAudit.nightAudit(propertyId, runId),
      transformResponse: (response: ApiSuccess<RunView>) => response.data,
      providesTags: (_r, _e, { runId }) => [{ type: "NightAudit", id: runId }],
    }),
    startNightAudit: build.mutation<
      RunView,
      { propertyId: string; reason: string; idempotencyKey: string }
    >({
      query: ({ propertyId, reason, idempotencyKey }) => ({
        url: API.nightAudit.nightAudits(propertyId),
        method: "POST",
        body: { reason },
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      transformResponse: (response: ApiSuccess<RunView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => nightAuditRolledTags(propertyId),
    }),
    recoverNightAudit: build.mutation<
      RunView,
      { propertyId: string; runId: string; reason: string }
    >({
      query: ({ propertyId, runId, reason }) => ({
        url: API.nightAudit.nightAuditRecover(propertyId, runId),
        method: "POST",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<RunView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => [
        "NightAudit",
        "BusinessDate",
        optionsTag(propertyId),
      ],
    }),
  }),
});

export const {
  useNightAuditReadinessQuery,
  useNightAuditRunsQuery,
  useNightAuditRunQuery,
  useStartNightAuditMutation,
  useRecoverNightAuditMutation,
} = nightAuditApi;
