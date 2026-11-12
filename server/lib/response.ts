import type { Response } from "express";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AppError, appError } from "@/lib/customError";
import { databaseErrorCode } from "@/lib/db/transaction";
import { logServerError } from "@/lib/log";
import type { ApiErrorBody, ApiSuccess } from "@serene/shared/types/api";

/**
 * The response envelope (docs/SERVER_SPLIT_PLAN.md §3):
 *   success: { success: true,  message, data, meta? }
 *   failure: { success: false, message, error: { code, details?, requestId } }
 */

export interface SuccessOptions<M = undefined> {
  status?: number;
  meta?: M;
  message?: string;
}

export function successResponse<T, M = undefined>(
  res: Response,
  data: T,
  options: SuccessOptions<M> = {},
): Response {
  const body: ApiSuccess<T, M> = {
    success: true,
    message: options.message ?? "OK",
    data,
    ...(options.meta === undefined ? {} : { meta: options.meta }),
  };
  return res.status(options.status ?? 200).json(body);
}

/**
 * Sends any thrown value as the error envelope. Non-operational errors and
 * INTERNAL_ERROR are logged (redacted, lib/log.ts) and answered generically.
 */
export function errorResponse(res: Response, err: unknown, requestId?: string): Response {
  const id = requestId ?? (res.locals.requestId as string | undefined) ?? "unknown";
  const error = normalizeError(err);
  if (error.code === "INTERNAL_ERROR" || !error.isOperational) {
    logServerError("Unhandled error", err, id);
  }
  if (error.code === "RATE_LIMITED" && error.details?.retryAfterSeconds) {
    res.setHeader("retry-after", String(error.details.retryAfterSeconds));
  }
  const body: ApiErrorBody = {
    success: false,
    message: error.isOperational ? error.message : "An unexpected error occurred",
    error: {
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
      requestId: id,
    },
  };
  res.setHeader("x-request-id", id);
  res.setHeader("cache-control", "no-store");
  return res.status(error.status).json(body);
}

/** Body-parser / http-errors failures carry `type` and `status`. */
function parserError(err: unknown): AppError | null {
  if (typeof err !== "object" || err === null) return null;
  const { type, status } = err as { type?: unknown; status?: unknown };
  if (typeof type !== "string" || typeof status !== "number") return null;
  switch (type) {
    case "entity.too.large":
      return appError("PAYLOAD_TOO_LARGE", "The request body is too large", {
        limitBytes: MAX_JSON_BODY_BYTES,
      });
    case "entity.parse.failed":
      return appError("VALIDATION_FAILED", "Malformed JSON request body");
    case "charset.unsupported":
    case "encoding.unsupported":
      return appError("VALIDATION_FAILED", "Unsupported request body encoding");
    case "request.aborted":
    case "request.size.invalid":
      return appError("VALIDATION_FAILED", "The request body could not be read");
    default:
      return null;
  }
}

/**
 * Largest JSON request body accepted (the biggest legitimate one, an avatar,
 * is ~350 KB of base64). Enforced by express.json against Content-Length and
 * while the body streams in, so an oversized body is never buffered.
 */
export const MAX_JSON_BODY_BYTES = 1_048_576;

/**
 * Maps any thrown value to an AppError. Database constraint violations become
 * CONFLICT / BUSINESS_RULE_VIOLATION so a race that slips past service
 * validation still yields a meaningful response.
 */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const parsing = parserError(err);
  if (parsing) return parsing;

  if (err instanceof z.ZodError) {
    return appError("VALIDATION_FAILED", "The request is invalid", {
      fields: z.flattenError(err).fieldErrors,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return appError("CONFLICT", "A record with these values already exists");
      case "P2003":
        return appError(
          "BUSINESS_RULE_VIOLATION",
          "A referenced record does not exist or belongs to another property",
        );
      case "P2025":
        return appError("NOT_FOUND", "Record not found");
      case "P2034":
        return appError("CONFLICT", "The operation conflicted with another change. Please retry.");
    }
  }

  // Raw PostgreSQL errors surfaced through the pg driver adapter.
  switch (databaseErrorCode(err)) {
    case "23505":
      return appError("CONFLICT", "A record with these values already exists");
    case "23P01":
      return appError(
        "CONFLICT",
        "This conflicts with an existing booking or block for the same dates",
      );
    case "23503":
      return appError(
        "BUSINESS_RULE_VIOLATION",
        "A referenced record does not exist or belongs to another property",
      );
    case "23514":
    case "SM001":
    case "SM002":
    case "SM003":
      return appError("BUSINESS_RULE_VIOLATION", "The change violates a data integrity rule");
    case "SM004":
      // Posting-date lock (D32): a financial row for a date other than the current one.
      return appError("BUSINESS_DATE_LOCKED", "That business date is closed for postings");
    case "40001":
    case "40P01":
      return appError("CONFLICT", "The operation conflicted with another change. Please retry.");
  }

  return new AppError(500, "An unexpected error occurred", false, "INTERNAL_ERROR");
}
