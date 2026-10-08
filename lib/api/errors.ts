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

/**
 * What an HTTP status means when the reply has no API error envelope (an
 * HTML error page from a proxy or a dev server): each kind of failure gets
 * its own words, so a 404 never reads as a connection problem.
 */
export function statusFallback(status: number): { code: ErrorCode; message: string } {
  if (status === 400 || status === 422) {
    return {
      code: "VALIDATION_FAILED",
      message: `The server rejected the request (HTTP ${status}). Check the entries and try again.`,
    };
  }
  if (status === 401) {
    return {
      code: "UNAUTHENTICATED",
      message: "Your session has ended. Sign in again to continue.",
    };
  }
  if (status === 403) {
    return { code: "FORBIDDEN", message: "You do not have permission to do this (HTTP 403)." };
  }
  if (status === 404) {
    return {
      code: "NOT_FOUND",
      message:
        "The server could not find this action (HTTP 404). Reload the page; if it keeps happening, the server needs restarting.",
    };
  }
  if (status === 409) {
    return {
      code: "CONFLICT",
      message: "Someone else changed this record (HTTP 409). Reload and try again.",
    };
  }
  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "Too many requests (HTTP 429). Wait a moment and try again.",
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: `The server had a problem (HTTP ${status}). Try again; if it keeps happening, contact your administrator.`,
  };
}

/**
 * Normalizes RTK Query errors into the API error envelope for display.
 * "Cannot reach the server" is reserved for requests that got no reply at
 * all; any HTTP status (400/401/403/404/409/5xx) reports what it means.
 */
export function toClientApiError(
  error: FetchBaseQueryError | SerializedError | undefined,
): ClientApiError | null {
  if (!error) return null;
  if ("status" in error && typeof error.status === "number") {
    const body = error.data as Partial<ApiErrorBody> | undefined;
    const envelope = body?.error;
    const fallback = statusFallback(error.status);
    return {
      code: envelope?.code ?? fallback.code,
      message: envelope?.message ?? fallback.message,
      status: error.status,
      requestId: envelope?.requestId ?? null,
      fieldErrors: (envelope?.details?.fields as Record<string, string[]> | undefined) ?? {},
      details: (envelope?.details as Record<string, unknown> | undefined) ?? {},
    };
  }
  // The server answered, but not with JSON (an HTML error page, e.g. the
  // 404 page of a dev server whose route table went stale). The request did
  // reach it (QA report, "Take & start").
  if ("status" in error && error.status === "PARSING_ERROR") {
    return { ...EMPTY, ...statusFallback(error.originalStatus), status: error.originalStatus };
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
