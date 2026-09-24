import "server-only";
import type { ErrorCode } from "@/types/api";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  BUSINESS_RULE_VIOLATION: 422,
  INVALID_STATE_TRANSITION: 422,
  BUSINESS_DATE_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PAYMENT_PROVIDER_ERROR: 502,
};

/**
 * The only error type services throw on purpose. Anything else reaching the
 * HTTP boundary is treated as INTERNAL_ERROR and logged with its stack.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const notFound = (resource: string) => new AppError("NOT_FOUND", `${resource} not found`);

export const forbidden = (permission?: string) =>
  new AppError(
    "FORBIDDEN",
    "You do not have permission to perform this action",
    permission ? { permission } : undefined,
  );

export const invalidTransition = (entity: string, from: string, to: string) =>
  new AppError("INVALID_STATE_TRANSITION", `${entity} cannot move from ${from} to ${to}`, {
    entity,
    from,
    to,
  });

export const staleVersion = (resource: string) =>
  new AppError("CONFLICT", `${resource} was changed by someone else. Reload and try again.`, {
    reason: "STALE_VERSION",
  });
