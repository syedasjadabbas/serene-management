import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { SerializedError } from "@reduxjs/toolkit";
import type { ApiErrorBody, ErrorCode } from "@/types/api";

export interface ClientApiError {
  code: ErrorCode | "NETWORK_ERROR";
  message: string;
  status: number | null;
  requestId: string | null;
  fieldErrors: Record<string, string[]>;
  /** Machine-readable details (e.g. `reason`, duplicate `matches`). */
  details: Record<string, unknown>;
}

/** Normalizes RTK Query errors into the API error envelope for display. */
export function toClientApiError(
  error: FetchBaseQueryError | SerializedError | undefined,
): ClientApiError | null {
  if (!error) return null;
  if ("status" in error && typeof error.status === "number") {
    const body = error.data as Partial<ApiErrorBody> | undefined;
    const envelope = body?.error;
    return {
      code: envelope?.code ?? "INTERNAL_ERROR",
      message: envelope?.message ?? "The server returned an unexpected response.",
      status: error.status,
      requestId: envelope?.requestId ?? null,
      fieldErrors: (envelope?.details?.fields as Record<string, string[]> | undefined) ?? {},
      details: (envelope?.details as Record<string, unknown> | undefined) ?? {},
    };
  }
  // The server answered, but not with the API envelope (an HTML error page,
  // e.g. a 404 from a dev server whose route table went stale). The request
  // did reach it, so "cannot reach the server" would send people chasing
  // their Wi-Fi (QA report, "Take & start").
  if ("status" in error && error.status === "PARSING_ERROR") {
    return {
      ...EMPTY,
      code: "INTERNAL_ERROR",
      message: `The server returned an unexpected response (HTTP ${error.originalStatus}). Reload the page and try again; if it keeps happening, contact your administrator.`,
      status: error.originalStatus,
    };
  }
  if ("status" in error && error.status === "TIMEOUT_ERROR") {
    return {
      ...EMPTY,
      message: "The server took too long to answer. Check your connection and try again.",
    };
  }
  if ("status" in error && error.status === "FETCH_ERROR") {
    return {
      ...EMPTY,
      message: "Cannot reach the server. Check your connection and try again.",
    };
  }
  // A SerializedError: the request was never sent because code in this page
  // failed while preparing it. That is not a connection problem either.
  return {
    ...EMPTY,
    code: "INTERNAL_ERROR",
    message: "Something went wrong on this page. Reload the page and try again.",
  };
}

const EMPTY: ClientApiError = {
  code: "NETWORK_ERROR",
  message: "",
  status: null,
  requestId: null,
  fieldErrors: {},
  details: {},
};
