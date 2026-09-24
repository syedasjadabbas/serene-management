import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { databaseErrorCode } from "@/lib/db/transaction";
import type { ApiErrorBody, ApiSuccess } from "@/types/api";
import { AppError } from "./errors";

export function ok<T, M = undefined>(data: T, meta?: M, init?: ResponseInit) {
  const body: ApiSuccess<T, M> = meta === undefined ? { data } : { data, meta };
  return NextResponse.json(body, init);
}

export function created<T>(data: T) {
  return ok(data, undefined, { status: 201 });
}

/**
 * Maps any thrown value to the structured error envelope. Database constraint
 * violations become CONFLICT / BUSINESS_RULE_VIOLATION so a race that slips
 * past service validation still yields a meaningful response.
 */
export function toErrorResponse(err: unknown, requestId: string, headers?: HeadersInit) {
  const appError = normalizeError(err);
  if (appError.code === "INTERNAL_ERROR") {
    console.error(`[${requestId}]`, err);
  }
  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId,
    },
  };
  const response = NextResponse.json(body, { status: appError.status, headers });
  response.headers.set("x-request-id", requestId);
  return response;
}

export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof z.ZodError) {
    return new AppError("VALIDATION_FAILED", "The request is invalid", {
      fields: z.flattenError(err).fieldErrors,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return new AppError("CONFLICT", "A record with these values already exists");
      case "P2003":
        return new AppError(
          "BUSINESS_RULE_VIOLATION",
          "A referenced record does not exist or belongs to another property",
        );
      case "P2025":
        return new AppError("NOT_FOUND", "Record not found");
      case "P2034":
        return new AppError(
          "CONFLICT",
          "The operation conflicted with another change. Please retry.",
        );
    }
  }

  // Raw PostgreSQL errors surfaced through the pg driver adapter.
  switch (databaseErrorCode(err)) {
    case "23505":
      return new AppError("CONFLICT", "A record with these values already exists");
    case "23P01":
      return new AppError(
        "CONFLICT",
        "This conflicts with an existing booking or block for the same dates",
      );
    case "23503":
      return new AppError(
        "BUSINESS_RULE_VIOLATION",
        "A referenced record does not exist or belongs to another property",
      );
    case "23514":
    case "SM001":
    case "SM002":
      return new AppError("BUSINESS_RULE_VIOLATION", "The change violates a data integrity rule");
    case "40001":
    case "40P01":
      return new AppError(
        "CONFLICT",
        "The operation conflicted with another change. Please retry.",
      );
  }

  return new AppError("INTERNAL_ERROR", "An unexpected error occurred");
}
