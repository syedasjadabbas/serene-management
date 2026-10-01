import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import type { SessionContext } from "@/lib/http/context";
import { AppError, notFound } from "@/lib/http/errors";
import { canAccessProperty } from "@/lib/permissions/evaluate";
import {
  type JobKind,
  type JobProgress,
  type JobView,
  LeaseLostError,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  toJobView,
} from "./jobs.policy";
import {
  type ClaimedJobRow,
  type JobFence,
  type JobFilter,
  type ReclaimedJob,
  cancelJob,
  claimNextJob,
  completeJob,
  failAttempt,
  findJob,
  findJobForSubject,
  findJobPayload,
  insertJob,
  lockFencedJob,
  lockJobForSubject,
  queueStats,
  reclaimExpiredJobs,
  renewLease,
  updateProgress,
} from "./jobs.repository";

/**
 * Background jobs (docs/SCALABILITY.md §33, ARCHITECTURE D65): the durable
 * queue in PostgreSQL. Requests enqueue inside their own transaction, so a job
 * exists exactly when the change that asked for it commits. Workers
 * (lib/jobs/worker.ts) claim, fence and finish jobs through the functions
 * below; requesters read them through `getJobForRequester` only.
 */

export type { ClaimedJobRow, JobFence, JobFilter, ReclaimedJob };

export interface JobScope {
  organizationId: string;
  propertyId: string | null;
  createdById: string;
}

export interface EnqueueInput {
  kind: JobKind;
  /**
   * Internal input of the handler. `subjectId` names the record the job works
   * on (e.g. the night audit run), so its screen can find the job.
   */
  payload: Record<string, unknown> & { subjectId?: string };
  /** At most one QUEUED or RUNNING job per key. */
  dedupeKey?: string | null;
  maxAttempts?: number;
}

export async function enqueueJob(
  tx: Tx,
  scope: JobScope,
  input: EnqueueInput,
): Promise<{ id: string; status: string }> {
  try {
    return await insertJob(tx, {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      createdById: scope.createdById,
      kind: input.kind,
      dedupeKey: input.dedupeKey ?? null,
      payload: input.payload as Prisma.InputJsonValue,
      maxAttempts: input.maxAttempts ?? 5,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "This work is already queued", {
        reason: "JOB_ALREADY_QUEUED",
      });
    }
    throw error;
  }
}

/**
 * A job as its requester may see it. Only the user who started it, in their
 * own organization, and only while they can still reach its property; any
 * other job is indistinguishable from a missing one (404).
 */
export async function getJobForRequester(ctx: SessionContext, jobId: string): Promise<JobView> {
  const job = await findJob(prisma, jobId);
  if (
    !job ||
    job.organizationId !== ctx.organizationId ||
    job.createdById !== ctx.userId ||
    (job.propertyId !== null && !canAccessProperty(ctx.access, job.propertyId))
  ) {
    throw notFound("Job");
  }
  return toJobView(job);
}

/** The newest job working on `subjectId` at the property (the caller authorized the subject). */
export async function findSubjectJob(
  propertyId: string,
  kind: JobKind,
  subjectId: string,
): Promise<(JobView & { leaseLive: boolean }) | null> {
  const job = await findJobForSubject(prisma, propertyId, kind, subjectId);
  if (!job) return null;
  return {
    ...toJobView(job),
    leaseLive: job.status === "RUNNING" && !!job.lockedUntil && job.lockedUntil > new Date(),
  };
}

/**
 * Stops the job of a subject from the subject's own transaction (e.g. a night
 * audit run being recovered): "none" (no job), "finished", "live" (a worker
 * holds a valid lease: left alone), or "cancelled" (it was QUEUED, or RUNNING
 * with an expired lease; it can now never run or finish).
 */
export async function stopSubjectJob(
  tx: Tx,
  propertyId: string,
  kind: JobKind,
  subjectId: string,
  error: { code: string; message: string },
  now: Date = new Date(),
): Promise<"none" | "finished" | "live" | "cancelled-queued" | "cancelled-abandoned"> {
  const job = await lockJobForSubject(tx, propertyId, kind, subjectId);
  if (!job) return "none";
  if (job.status !== "QUEUED" && job.status !== "RUNNING") return "finished";
  if (job.status === "RUNNING" && job.locked_until && job.locked_until > now) return "live";
  await cancelJob(tx, job.id, error);
  return job.status === "QUEUED" ? "cancelled-queued" : "cancelled-abandoned";
}

// --- Worker side ---------------------------------------------------------------------------------

export function claimJob(
  workerId: string,
  kinds: readonly string[],
  leaseMs: number,
  filter?: JobFilter,
) {
  return claimNextJob(prisma, workerId, kinds, leaseMs, filter);
}

export function renewJobLease(fence: JobFence, leaseMs: number) {
  return renewLease(prisma, fence, leaseMs);
}

/** Inside the caller's transaction: proceeds only while this worker holds the job. */
export async function assertJobLease(tx: Tx, fence: JobFence): Promise<void> {
  if (!(await lockFencedJob(tx, fence))) throw new LeaseLostError();
}

export function reportJobProgress(fence: JobFence, progress: JobProgress) {
  return updateProgress(prisma, fence, progress as unknown as Prisma.InputJsonValue);
}

/** Marks the job SUCCEEDED, in the caller's transaction or on its own. */
export async function finishJob(
  fence: JobFence,
  result: Record<string, unknown> | null,
  tx?: Tx,
): Promise<void> {
  const done = await completeJob(tx ?? prisma, fence, result as Prisma.InputJsonValue | null);
  if (!done) throw new LeaseLostError();
}

export function recordJobFailure(
  fence: JobFence,
  outcome: { retryInMs: number | null; errorCode: string; errorMessage: string; lastError: string },
) {
  return failAttempt(prisma, fence, outcome);
}

export function reclaimExpiredLeases(limit = 50, filter?: JobFilter) {
  return reclaimExpiredJobs(prisma, limit, { baseMs: RETRY_BASE_MS, maxMs: RETRY_MAX_MS }, filter);
}

export function jobQueueStats() {
  return queueStats(prisma);
}

/** A job that just ended FAILED, with its payload, for the handler's compensation. */
export async function loadFailedJob(id: string) {
  const job = await findJobPayload(prisma, id);
  if (!job || job.status !== "FAILED") return null;
  return {
    id: job.id,
    organizationId: job.organizationId,
    propertyId: job.propertyId,
    createdById: job.createdById,
    payload: job.payload,
  };
}
