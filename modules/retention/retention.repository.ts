import "server-only";
import type { Db } from "@/lib/db/prisma";
import type { RetentionTarget } from "./retention.policy";

/**
 * Batched pruning statements (retention.service). Each call is one
 * autocommit statement: a batch commits on its own, so no long transaction
 * builds up and locks are held only for the batch. Rows locked by a running
 * request are skipped (SKIP LOCKED) and picked up by a later run.
 *
 * Takes the client as a parameter (not the module singleton) so operators
 * and tests can point it at a specific database.
 */

type Client = Pick<Db, "$executeRaw" | "$queryRaw">;

export function deleteBatch(
  db: Client,
  target: RetentionTarget,
  cutoff: Date,
  limit: number,
): Promise<number> {
  switch (target) {
    case "authSessions":
      return db.$executeRaw`
        DELETE FROM "auth_sessions" WHERE "id" IN (
          SELECT "id" FROM "auth_sessions"
          WHERE "expires_at" < ${cutoff} OR "revoked_at" < ${cutoff}
          LIMIT ${limit} FOR UPDATE SKIP LOCKED)`;
    case "passwordResetTokens":
      return db.$executeRaw`
        DELETE FROM "password_reset_tokens" WHERE "id" IN (
          SELECT "id" FROM "password_reset_tokens"
          WHERE "expires_at" < ${cutoff} OR "used_at" < ${cutoff}
          LIMIT ${limit} FOR UPDATE SKIP LOCKED)`;
    case "idempotencyKeys":
      return db.$executeRaw`
        DELETE FROM "idempotency_keys" WHERE ("user_id", "key") IN (
          SELECT "user_id", "key" FROM "idempotency_keys"
          WHERE "expires_at" < ${cutoff}
          LIMIT ${limit} FOR UPDATE SKIP LOCKED)`;
    case "outboxPublished":
      return db.$executeRaw`
        DELETE FROM "outbox_events" WHERE "id" IN (
          SELECT "id" FROM "outbox_events"
          WHERE "status" = 'PUBLISHED' AND "published_at" < ${cutoff}
          LIMIT ${limit} FOR UPDATE SKIP LOCKED)`;
    case "outboxFailed":
      return db.$executeRaw`
        DELETE FROM "outbox_events" WHERE "id" IN (
          SELECT "id" FROM "outbox_events"
          WHERE "status" = 'FAILED' AND "occurred_at" < ${cutoff}
          LIMIT ${limit} FOR UPDATE SKIP LOCKED)`;
  }
}

export async function countEligible(
  db: Client,
  target: RetentionTarget,
  cutoff: Date,
): Promise<number> {
  const rows = await (() => {
    switch (target) {
      case "authSessions":
        return db.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM "auth_sessions"
          WHERE "expires_at" < ${cutoff} OR "revoked_at" < ${cutoff}`;
      case "passwordResetTokens":
        return db.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM "password_reset_tokens"
          WHERE "expires_at" < ${cutoff} OR "used_at" < ${cutoff}`;
      case "idempotencyKeys":
        return db.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM "idempotency_keys" WHERE "expires_at" < ${cutoff}`;
      case "outboxPublished":
        return db.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM "outbox_events"
          WHERE "status" = 'PUBLISHED' AND "published_at" < ${cutoff}`;
      case "outboxFailed":
        return db.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM "outbox_events"
          WHERE "status" = 'FAILED' AND "occurred_at" < ${cutoff}`;
    }
  })();
  return Number(rows[0]?.n ?? 0);
}

/** Outbox events still waiting for a publisher (reported, never pruned). */
export async function countPendingOutbox(db: Client): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "outbox_events" WHERE "status" = 'PENDING'`;
  return Number(rows[0]?.n ?? 0);
}
