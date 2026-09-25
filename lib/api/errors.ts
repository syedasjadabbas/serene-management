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
  return {
    code: "NETWORK_ERROR",
    message: "Cannot reach the server. Check your connection and try again.",
    status: null,
    requestId: null,
    fieldErrors: {},
    details: {},
  };
}
