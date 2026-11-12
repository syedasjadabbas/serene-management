import type { ErrorCode } from "@serene/shared/types/api";

/** HTTP status of every error code (unchanged from the Next.js server). */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  BUSINESS_RULE_VIOLATION: 422,
  INVALID_STATE_TRANSITION: 422,
  BUSINESS_DATE_LOCKED: 423,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PAYMENT_PROVIDER_ERROR: 502,
};

/**
 * The only error type services throw on purpose. `isOperational` errors are
 * expected outcomes (validation, permission, business rules) and are answered
 * as they are; anything else reaching the error handler is logged with its
 * stack and answered as INTERNAL_ERROR.
 *
 * Services normally use `appError(code, message, details?)`, which derives
 * the status from the code.
 */
export class AppError extends Error {
  readonly status: number;
  readonly isOperational: boolean;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    isOperational = true,
    code: ErrorCode = "INTERNAL_ERROR",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.isOperational = isOperational;
    this.code = code;
    this.details = details;
  }
}

/** Builds an AppError from an error code (status from the code table). */
export function appError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(STATUS_BY_CODE[code], message, true, code, details);
}

export const notFound = (resource: string) => appError("NOT_FOUND", `${resource} not found`);

export const forbidden = (permission?: string) =>
  appError(
    "FORBIDDEN",
    "You do not have permission to perform this action",
    permission ? { permission } : undefined,
  );

export const invalidTransition = (entity: string, from: string, to: string) =>
  appError("INVALID_STATE_TRANSITION", `${entity} cannot move from ${from} to ${to}`, {
    entity,
    from,
    to,
  });

export const staleVersion = (resource: string) =>
  appError("CONFLICT", `${resource} was changed by someone else. Reload and try again.`, {
    reason: "STALE_VERSION",
  });
