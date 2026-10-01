import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/lib/db/prisma";
import type { JobStatus } from "./jobs.policy";

/**
 * Background job storage (migration 20261220090000_background_jobs). The queue
 * protocol lives in these statements:
 *
 * - Claim: the oldest due QUEUED job, FOR UPDATE SKIP LOCKED, becomes RUNNING
 *   with a lease (`locked_by`, `locked_until`) and `attempts + 1`. Concurrent
 *   workers skip each other's rows, so a job is claimed once.
 * - Fence: every later write by the worker requires status RUNNING, its own
 *   `locked_by` and the attempt number it claimed. After its lease expired and
 *   another worker re-claimed the job, a slow worker's writes match nothing.
 * - Reclaim: RUNNING jobs whose lease expired (the worker crashed, its
 *   instance died or lost the database) return to QUEUED after a backoff, or
 *   become FAILED when their attempts are used up. Rows locked by a running
 *   transaction (a commit fencing its job) are skipped, never reclaimed.
 */

type Client = Db | Tx;

export interface ClaimedJobRow {
  id: string;
  kind: string;
  organizationId: string;
  propertyId: string | null;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  createdById: string;
  createdAt: Date;
}

export interface JobFence {
  id: string;
  workerId: string;
  attempt: number;
}

const msInterval = (ms: number) => `${Math.max(0, Math.trunc(ms))} milliseconds`;

export function insertJob(
  tx: Tx,
  data: {
    organizationId: string;
    propertyId: string | null;
    kind: string;
    dedupeKey: string | null;
    payload: Prisma.InputJsonValue;
    maxAttempts: number;
    createdById: string;
  },
) {
  return tx.backgroundJob.create({ data, select: { id: true, status: true } });
}

/** Restricts a worker to one property's jobs (tests, an operator draining one hotel). */
export interface JobFilter {
  propertyId?: string | null;
}

export async function claimNextJob(
  db: Client,
  workerId: string,
  kinds: readonly string[],
  leaseMs: number,
  filter: JobFilter = {},
): Promise<ClaimedJobRow | null> {
  const property = filter.propertyId ?? null;
  const rows = await db.$queryRaw<
    {
      id: string;
      kind: string;
      organization_id: string;
      property_id: string | null;
      payload: unknown;
      attempts: number;
      max_attempts: number;
      created_by_id: string;
      created_at: Date;
    }[]
  >`
    WITH next AS (
      SELECT "id" FROM "background_jobs"
      WHERE "status" = 'QUEUED' AND "run_after" <= now()
        AND "kind" = ANY(${[...kinds]}::text[]) AND "attempts" < "max_attempts"
        AND (${property}::uuid IS NULL OR "property_id" = ${property}::uuid)
      ORDER BY "run_after", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "background_jobs" j
    SET "status" = 'RUNNING', "attempts" = j."attempts" + 1, "locked_by" = ${workerId},
        "locked_until" = now() + ${msInterval(leaseMs)}::interval, "heartbeat_at" = now(),
        "started_at" = COALESCE(j."started_at", now()), "progress" = NULL, "updated_at" = now()
    FROM next
    WHERE j."id" = next."id"
    RETURNING j."id", j."kind", j."organization_id", j."property_id", j."payload", j."attempts",
              j."max_attempts", j."created_by_id", j."created_at"`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdById: row.created_by_id,
    createdAt: row.created_at,
  };
}

/**
 * Extends the lease. "busy": the row is locked by a transaction right now
 * (typically the job's own commit, which fences it) — the lease is still
 * ours and that transaction finishes or rolls back the job itself.
 */
export async function renewLease(
  db: Client,
  fence: JobFence,
  leaseMs: number,
): Promise<"renewed" | "busy" | "lost"> {
  const renewed = await db.$queryRaw<{ id: string }[]>`
    UPDATE "background_jobs" SET "locked_until" = now() + ${msInterval(leaseMs)}::interval,
           "heartbeat_at" = now()
    WHERE "id" IN (
      SELECT "id" FROM "background_jobs"
      WHERE "id" = ${fence.id}::uuid AND "status" = 'RUNNING' AND "locked_by" = ${fence.workerId}
        AND "attempts" = ${fence.attempt}
      FOR UPDATE SKIP LOCKED)
    RETURNING "id"`;
  if (renewed.length > 0) return "renewed";
  const still = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "background_jobs"
    WHERE "id" = ${fence.id}::uuid AND "status" = 'RUNNING' AND "locked_by" = ${fence.workerId}
      AND "attempts" = ${fence.attempt}`;
  return still.length > 0 ? "busy" : "lost";
}

/**
 * Locks the job row for the caller's transaction if this worker still holds
 * it. While the lock is held the job cannot be reclaimed, cancelled or
 * renewed elsewhere; work committed in the same transaction is therefore
 * done by the lease holder only.
 */
export async function lockFencedJob(tx: Tx, fence: JobFence): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "background_jobs"
    WHERE "id" = ${fence.id}::uuid AND "status" = 'RUNNING' AND "locked_by" = ${fence.workerId}
      AND "attempts" = ${fence.attempt}
    FOR UPDATE`;
  return rows.length > 0;
}

export async function updateProgress(
  db: Client,
  fence: JobFence,
  progress: Prisma.InputJsonValue,
): Promise<boolean> {
  const count = await db.$executeRaw`
    UPDATE "background_jobs" SET "progress" = ${JSON.stringify(progress)}::jsonb,
           "updated_at" = now()
    WHERE "id" = ${fence.id}::uuid AND "status" = 'RUNNING' AND "locked_by" = ${fence.workerId}
      AND "attempts" = ${fence.attempt}`;
  return count > 0;
}

export async function completeJob(
  db: Client,
  fence: JobFence,
  result: Prisma.InputJsonValue | null,
): Promise<boolean> {
  const count = await db.$executeRaw`
    UPDATE "background_jobs"
    SET "status" = 'SUCCEEDED', "result" = ${result === null ? null : JSON.stringify(result)}::jsonb,
        "progress" = NULL, "locked_by" = NULL, "locked_until" = NULL, "finished_at" = now(),
        "error_code" = NULL, "error_message" = NULL, "updated_at" = now()
    WHERE "id" = ${fence.id}::uuid AND "status" = 'RUNNING' AND "locked_by" = ${fence.workerId}
      AND "attempts" = ${fence.attempt}`;
  return count > 0;
}

/** Records a failed attempt: QUEUED again after `retryInMs`, or FAILED when it is null. */
export async function failAttempt(
  db: Client,
  fence: JobFence,
  outcome: {
    retryInMs: number | null;
    errorCode: string;
    errorMessage: string;
    lastError: string;
  },
): Promise<boolean> {
  const retry = outcome.retryInMs !== null;
  const count = await db.$executeRaw`
    UPDATE "background_jobs"
    SET "status" = ${retry ? "QUEUED" : "FAILED"}::"background_job_status",
        "run_after" = CASE WHEN ${retry} THEN now() + ${msInterval(outcome.retryInMs ?? 0)}::interval
                           ELSE "run_after" END,
        "finished_at" = CASE WHEN ${retry} THEN NULL ELSE now() END,
        "locked_by" = NULL, "locked_until" = NULL, "progress" = NULL,
        "error_code" = ${outcome.errorCode.slice(0, 60)}, "error_message" = ${outcome.errorMessage.slice(0, 500)},
        "last_error" = ${outcome.lastError.slice(0, 2000)}, "updated_at" = now()
    WHERE "id" = ${fence.id}::uuid AND "status" = 'RUNNING' AND "locked_by" = ${fence.workerId}
      AND "attempts" = ${fence.attempt}`;
  return count > 0;
}

export interface ReclaimedJob {
  id: string;
  kind: string;
  status: JobStatus;
}

/**
 * Releases expired leases (at most `limit` per call). Backoff: base · 2^(attempts−1),
 * capped, with 50–100 % jitter — the same schedule as `retryDelayMs`.
 */
export async function reclaimExpiredJobs(
  db: Client,
  limit: number,
  backoff: { baseMs: number; maxMs: number },
  filter: JobFilter = {},
): Promise<ReclaimedJob[]> {
  const property = filter.propertyId ?? null;
  return db.$queryRaw<ReclaimedJob[]>`
    WITH expired AS (
      SELECT "id" FROM "background_jobs"
      WHERE "status" = 'RUNNING' AND "locked_until" < now()
        AND (${property}::uuid IS NULL OR "property_id" = ${property}::uuid)
      ORDER BY "locked_until"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "background_jobs" j
    SET "status" = (CASE WHEN j."attempts" >= j."max_attempts" THEN 'FAILED' ELSE 'QUEUED' END)::"background_job_status",
        "run_after" = CASE WHEN j."attempts" >= j."max_attempts" THEN j."run_after"
          ELSE now() + make_interval(secs => LEAST(${backoff.maxMs}::float8,
                 ${backoff.baseMs}::float8 * power(2, GREATEST(j."attempts" - 1, 0)))
                 * (0.5 + random() * 0.5) / 1000) END,
        "finished_at" = CASE WHEN j."attempts" >= j."max_attempts" THEN now() ELSE NULL END,
        "locked_by" = NULL, "locked_until" = NULL, "progress" = NULL,
        "error_code" = 'WORKER_LOST',
        "error_message" = CASE WHEN j."attempts" >= j."max_attempts"
          THEN 'The job stopped responding and its attempts are used up'
          ELSE 'The job stopped responding; it will be retried automatically' END,
        "last_error" = 'Lease expired: the worker stopped or lost its database connection',
        "updated_at" = now()
    FROM expired
    WHERE j."id" = expired."id"
    RETURNING j."id", j."kind", j."status"::text AS "status"`;
}

const VIEW_SELECT = {
  id: true,
  kind: true,
  status: true,
  organizationId: true,
  propertyId: true,
  attempts: true,
  maxAttempts: true,
  progress: true,
  result: true,
  errorCode: true,
  errorMessage: true,
  createdById: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  runAfter: true,
  lockedUntil: true,
} as const;

export function findJob(db: Client, id: string) {
  return db.backgroundJob.findUnique({ where: { id }, select: VIEW_SELECT });
}

export function findJobPayload(db: Client, id: string) {
  return db.backgroundJob.findUnique({
    where: { id },
    select: { ...VIEW_SELECT, payload: true },
  });
}

/** The newest job of a kind whose payload names `subjectId` (e.g. a night audit run). */
export async function findJobForSubject(
  db: Client,
  propertyId: string,
  kind: string,
  subjectId: string,
) {
  return db.backgroundJob.findFirst({
    where: { propertyId, kind, payload: { path: ["subjectId"], equals: subjectId } },
    orderBy: { createdAt: "desc" },
    select: VIEW_SELECT,
  });
}

/** Locks the job of a subject in the caller's transaction (waits for a commit holding it). */
export async function lockJobForSubject(
  tx: Tx,
  propertyId: string,
  kind: string,
  subjectId: string,
): Promise<{ id: string; status: JobStatus; locked_until: Date | null } | null> {
  const rows = await tx.$queryRaw<{ id: string; status: JobStatus; locked_until: Date | null }[]>`
    SELECT "id", "status"::text AS "status", "locked_until" FROM "background_jobs"
    WHERE "property_id" = ${propertyId}::uuid AND "kind" = ${kind}
      AND "payload"->>'subjectId' = ${subjectId}
    ORDER BY "created_at" DESC
    LIMIT 1
    FOR UPDATE`;
  return rows[0] ?? null;
}

/** Ends a job that has not finished (QUEUED, or RUNNING without a live owner). */
export async function cancelJob(
  tx: Tx,
  id: string,
  error: { code: string; message: string },
): Promise<boolean> {
  const count = await tx.$executeRaw`
    UPDATE "background_jobs"
    SET "status" = 'CANCELLED', "cancelled_at" = now(), "finished_at" = now(),
        "locked_by" = NULL, "locked_until" = NULL, "progress" = NULL,
        "error_code" = ${error.code}, "error_message" = ${error.message}, "updated_at" = now()
    WHERE "id" = ${id}::uuid AND "status" IN ('QUEUED', 'RUNNING')`;
  return count > 0;
}

/** Queue health for operators: counts by status, oldest due job, expired leases. */
export async function queueStats(db: Client) {
  const rows = await db.$queryRaw<
    {
      queued: bigint;
      due: bigint;
      running: bigint;
      expired: bigint;
      failed_24h: bigint;
      oldest_due_s: number | null;
    }[]
  >`
    SELECT
      count(*) FILTER (WHERE "status" = 'QUEUED') AS "queued",
      count(*) FILTER (WHERE "status" = 'QUEUED' AND "run_after" <= now()) AS "due",
      count(*) FILTER (WHERE "status" = 'RUNNING') AS "running",
      count(*) FILTER (WHERE "status" = 'RUNNING' AND "locked_until" < now()) AS "expired",
      count(*) FILTER (WHERE "status" = 'FAILED' AND "finished_at" > now() - interval '24 hours') AS "failed_24h",
      EXTRACT(EPOCH FROM now() - min("run_after") FILTER (WHERE "status" = 'QUEUED' AND "run_after" <= now()))::float8 AS "oldest_due_s"
    FROM "background_jobs"
    WHERE "status" IN ('QUEUED', 'RUNNING') OR "finished_at" > now() - interval '24 hours'`;
  const row = rows[0]!;
  return {
    queued: Number(row.queued),
    due: Number(row.due),
    running: Number(row.running),
    expiredLeases: Number(row.expired),
    failedLast24h: Number(row.failed_24h),
    oldestDueSeconds: row.oldest_due_s,
  };
}
