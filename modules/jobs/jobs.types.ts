import type { Tx } from "@/lib/db/prisma";
import type { JobKind, JobProgress } from "./jobs.policy";

/** One claimed attempt of a job, as its handler sees it. */
export interface JobRun {
  id: string;
  kind: string;
  organizationId: string;
  propertyId: string | null;
  createdById: string;
  /** This attempt's number, from 1. */
  attempt: number;
  maxAttempts: number;
  payload: unknown;
  /** Aborted when the worker learns it lost the lease, or is shutting down for good. */
  signal: AbortSignal;
  /** Public progress (stage names and counts only). Best effort. */
  progress(progress: JobProgress): Promise<void>;
  /**
   * Inside a transaction: throws LeaseLostError unless this worker still
   * holds the job, and locks the job row until that transaction ends, so the
   * transaction's work is committed by the lease holder only.
   */
  assertLease(tx: Tx): Promise<void>;
  /** Marks the job SUCCEEDED in `tx`, atomically with the handler's own writes. */
  completeIn(tx: Tx, result: Record<string, unknown> | null): Promise<void>;
}

/** A job that ended FAILED (attempts used up or a final error), for compensation. */
export interface FailedJob {
  id: string;
  organizationId: string;
  propertyId: string | null;
  createdById: string;
  payload: unknown;
}

export interface JobHandler {
  kind: JobKind;
  maxAttempts: number;
  /**
   * Does the work. Must be idempotent: after a crash or a lost lease the job
   * runs again, possibly after its work was committed. Returns the public
   * result. Throw JobFailure for an error that retrying cannot fix.
   */
  run(job: JobRun): Promise<Record<string, unknown> | null>;
  /** Called once the job ended FAILED, to undo what a half-done job left behind. */
  onGiveUp?(job: FailedJob): Promise<void>;
}
