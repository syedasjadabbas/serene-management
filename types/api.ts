/**
 * Wire contract shared by route handlers and RTK Query (docs/API_CONVENTIONS.md).
 * Success:  { data, meta? }
 * Failure:  { error: { code, message, details?, requestId } }
 */

export const ERROR_CODES = [
  "VALIDATION_FAILED", // 400/422: request body/query failed schema validation
  "UNAUTHENTICATED", // 401: missing/expired access token
  "FORBIDDEN", // 403: authenticated but lacks permission or property access
  "NOT_FOUND", // 404: resource absent (or outside caller's property scope)
  "CONFLICT", // 409: unique violation, stale version, overlapping assignment
  "BUSINESS_RULE_VIOLATION", // 422: valid input rejected by a domain rule
  "INVALID_STATE_TRANSITION", // 422: state machine forbids the transition
  "BUSINESS_DATE_LOCKED", // 423: night audit in progress / date closed
  "IDEMPOTENCY_CONFLICT", // 409: same Idempotency-Key, different payload
  "RATE_LIMITED", // 429
  "PAYMENT_PROVIDER_ERROR", // 502: gateway declined / unavailable
  "INTERNAL_ERROR", // 500
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Human-readable, safe to show. Localised on the client by `code`. */
    message: string;
    /** Field errors ({ path: messages[] }) or rule-specific context. */
    details?: Record<string, unknown>;
    requestId: string;
  };
}

export interface CursorPageMeta {
  nextCursor: string | null;
  limit: number;
}

export interface OffsetPageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiSuccess<T, M = undefined> {
  data: T;
  meta?: M;
}

export type CursorPage<T> = ApiSuccess<T[], CursorPageMeta>;
export type OffsetPage<T> = ApiSuccess<T[], OffsetPageMeta>;
