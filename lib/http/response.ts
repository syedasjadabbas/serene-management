import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
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
export function toErrorResponse(err: unknown, requestId: string) {
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
  return NextResponse.json(body, {
    status: appError.status,
    headers: { "x-request-id": requestId },
  });
}

function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof z.ZodError) {
    return new AppError("VALIDATION_FAILED", "The request is invalid", {
      fields: z.flattenError(err).fieldErrors,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002": // unique violation
        return new AppError("CONFLICT", "A record with these values already exists", {
          constraint: err.meta?.target,
        });
      case "P2003": // foreign key violation
        return new AppError(
          "BUSINESS_RULE_VIOLATION",
          "A referenced record does not exist or belongs to another property",
        );
      case "P2025": // record to update not found
        return new AppError("NOT_FOUND", "Record not found");
      case "P2034": // serialization failure / deadlock after retries
        return new AppError(
          "CONFLICT",
          "The operation conflicted with another change. Please retry.",
        );
    }
  }

  return new AppError("INTERNAL_ERROR", "An unexpected error occurred");
}
