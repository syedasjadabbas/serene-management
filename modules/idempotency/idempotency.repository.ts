import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * idempotency_keys: one row per (user, key). Claimed inside the command's
 * transaction, so a concurrent request with the same key waits on the
 * uncommitted row and then sees the stored response.
 */

/**
 * Inserts the key, or takes over an expired row. Returns true when this
 * transaction owns the key; false when a live row exists (committed by an
 * earlier or concurrent request, which this statement waited for).
 */
export async function claimKey(
  tx: Tx,
  row: { userId: string; key: string; route: string; requestHash: string; expiresAt: Date },
): Promise<boolean> {
  const claimed = await tx.$queryRaw<{ claimed: number }[]>`
    INSERT INTO "idempotency_keys" ("key", "user_id", "route", "request_hash", "expires_at")
    VALUES (${row.key}, ${row.userId}::uuid, ${row.route}, ${row.requestHash}, ${row.expiresAt})
    ON CONFLICT ("user_id", "key") DO UPDATE SET
      "route" = EXCLUDED."route",
      "request_hash" = EXCLUDED."request_hash",
      "status_code" = NULL,
      "response_body" = NULL,
      "created_at" = now(),
      "expires_at" = EXCLUDED."expires_at"
    WHERE "idempotency_keys"."expires_at" < now()
    RETURNING 1 AS "claimed"`;
  return claimed.length === 1;
}

export function findKey(tx: Tx, userId: string, key: string) {
  return tx.idempotencyKey.findUnique({
    where: { userId_key: { userId, key } },
    select: { route: true, requestHash: true, statusCode: true, responseBody: true },
  });
}

export function storeResponse(
  tx: Tx,
  userId: string,
  key: string,
  statusCode: number,
  responseBody: Prisma.InputJsonValue,
) {
  return tx.idempotencyKey.update({
    where: { userId_key: { userId, key } },
    data: { statusCode, responseBody },
  });
}
