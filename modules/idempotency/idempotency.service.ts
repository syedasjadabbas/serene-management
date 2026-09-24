import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";
import type { IdempotencyRequest } from "@/lib/http/context";
import { AppError } from "@/lib/http/errors";
import { claimKey, findKey, storeResponse } from "./idempotency.repository";

/** How long a stored response is replayed (docs/API_CONVENTIONS.md). */
const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Runs a financial command at most once per Idempotency-Key (docs/ARCHITECTURE.md
 * §5). Call it inside the command's transaction, right after the business-date
 * lock and before any other lock:
 *
 * - first request: claims the key, runs `work`, stores its result with the key;
 * - repeated request (same key, same route and body): returns the stored result
 *   without running `work` — nothing is posted twice;
 * - same key with a different request: 409 IDEMPOTENCY_CONFLICT.
 *
 * A concurrent duplicate blocks on the uncommitted key row until the first
 * transaction ends. If the first request failed, its key row rolled back with
 * it and the retry runs normally. `work`'s result must be plain JSON.
 */
export async function runIdempotent<T>(
  tx: Tx,
  userId: string,
  request: IdempotencyRequest | null,
  work: () => Promise<T>,
  statusCode = 201,
): Promise<{ result: T; replayed: boolean }> {
  if (!request) {
    throw new AppError("VALIDATION_FAILED", "An Idempotency-Key header is required");
  }
  const claimed = await claimKey(tx, {
    userId,
    key: request.key,
    route: request.route,
    requestHash: request.requestHash,
    expiresAt: new Date(Date.now() + RETENTION_MS),
  });

  if (!claimed) {
    const existing = await findKey(tx, userId, request.key);
    if (
      !existing ||
      existing.route !== request.route ||
      existing.requestHash !== request.requestHash
    ) {
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "This Idempotency-Key was already used for a different request",
      );
    }
    if (existing.responseBody === null) {
      throw new AppError("CONFLICT", "The same request is still being processed. Please retry.");
    }
    return { result: existing.responseBody as T, replayed: true };
  }

  const result = await work();
  await storeResponse(tx, userId, request.key, statusCode, result as Prisma.InputJsonValue);
  return { result, replayed: false };
}
