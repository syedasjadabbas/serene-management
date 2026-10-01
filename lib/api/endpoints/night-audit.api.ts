import type { RunListItem, ReadinessView, RunView } from "@/modules/night-audit/night-audit.types";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";
import { baseApi } from "../baseApi";

/**
 * Night audit (Phase 8). Starting a run carries an Idempotency-Key chosen
 * when the dialog opens. The run executes in a background job (202 RUNNING);
 * the run page follows it, and when it finishes the business date has rolled
 * (or reopened), so every operational list and the business date itself are
 * refetched (NIGHT_AUDIT_ROLLED_TAGS) — at the start too, as the date is
 * then IN_AUDIT.
 */

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
      query: (propertyId) => `/properties/${propertyId}/night-audits/readiness`,
      transformResponse: (response: ApiSuccess<ReadinessView>) => response.data,
      providesTags: ["NightAudit"],
    }),
    nightAuditRuns: build.query<
      { items: RunListItem[]; meta: CursorPageMeta },
      { propertyId: string; cursor?: string }
    >({
      query: ({ propertyId, cursor }) =>
        `/properties/${propertyId}/night-audits${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      transformResponse: (response: ApiSuccess<RunListItem[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: ["NightAudit"],
    }),
    nightAuditRun: build.query<RunView, { propertyId: string; runId: string }>({
      query: ({ propertyId, runId }) => `/properties/${propertyId}/night-audits/${runId}`,
      transformResponse: (response: ApiSuccess<RunView>) => response.data,
      providesTags: (_r, _e, { runId }) => [{ type: "NightAudit", id: runId }],
    }),
    startNightAudit: build.mutation<
      RunView,
      { propertyId: string; reason: string; idempotencyKey: string }
    >({
      query: ({ propertyId, reason, idempotencyKey }) => ({
        url: `/properties/${propertyId}/night-audits`,
        method: "POST",
        body: { reason },
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      transformResponse: (response: ApiSuccess<RunView>) => response.data,
      invalidatesTags: [...NIGHT_AUDIT_ROLLED_TAGS],
    }),
    recoverNightAudit: build.mutation<
      RunView,
      { propertyId: string; runId: string; reason: string }
    >({
      query: ({ propertyId, runId, reason }) => ({
        url: `/properties/${propertyId}/night-audits/${runId}/recover`,
        method: "POST",
        body: { reason },
      }),
      transformResponse: (response: ApiSuccess<RunView>) => response.data,
      invalidatesTags: ["NightAudit", "BusinessDate"],
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
