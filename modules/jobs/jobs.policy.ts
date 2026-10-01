/**
 * Background job rules (docs/SCALABILITY.md §33, ARCHITECTURE D65). Pure: no
 * I/O, so the retry schedule and the public view can be tested directly.
 */

export const JOB_KINDS = ["night_audit.run"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** First retry after about this long; each further retry waits twice as long. */
export const RETRY_BASE_MS = 5_000;
/** Retries never wait longer than this. */
export const RETRY_MAX_MS = 5 * 60_000;

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

/**
 * Wait before retry number `attempt` (the attempt that just failed, from 1):
 * exponential (base · 2^(attempt−1), capped), with jitter in [50 %, 100 %] so
 * jobs that failed together (a database restart) do not all return together.
 */
export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs = RETRY_BASE_MS,
  maxMs = RETRY_MAX_MS,
): number {
  const exponent = Math.min(Math.max(attempt, 1) - 1, 30);
  const ceiling = Math.min(maxMs, baseMs * 2 ** exponent);
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

/** Leases are renewed three times per lease period, so one late heartbeat never loses one. */
export function heartbeatIntervalMs(leaseMs: number): number {
  return Math.max(1_000, Math.floor(leaseMs / 3));
}

/**
 * What a failed attempt leads to: another attempt after the backoff, or the
 * end (FAILED) when the error is final or the attempts are used up.
 */
export function afterFailure(
  attempt: number,
  maxAttempts: number,
  retryable: boolean,
  random: () => number = Math.random,
): { retry: true; delayMs: number } | { retry: false } {
  if (!retryable || attempt >= maxAttempts) return { retry: false };
  return { retry: true, delayMs: retryDelayMs(attempt, random) };
}

/**
 * A failure the job cannot recover from by trying again (the input is no
 * longer valid, the requester lost the permission). Its code and message are
 * shown to the requester; anything else thrown by a handler is retried and
 * reported generically.
 */
export class JobFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "JobFailure";
  }
}

/** The worker no longer holds the job (its lease expired and another worker took it). */
export class LeaseLostError extends Error {
  constructor() {
    super("The job lease was lost");
    this.name = "LeaseLostError";
  }
}

/** Public progress of a running job: a stage name and optional counts. */
export interface JobProgress {
  stage: string;
  done?: number;
  total?: number;
}

/**
 * What a requester sees of a job. Never the payload, the internal error, the
 * worker or the lease.
 */
export interface JobView {
  id: string;
  kind: string;
  status: JobStatus;
  propertyId: string | null;
  attempts: number;
  maxAttempts: number;
  progress: JobProgress | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** When a queued job (first run or retry) becomes due. */
  runAfter: string | null;
}

export interface JobViewSource {
  id: string;
  kind: string;
  status: JobStatus;
  propertyId: string | null;
  attempts: number;
  maxAttempts: number;
  progress: unknown;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  runAfter: Date;
}

const STAGE = /^[A-Z][A-Z0-9_]{0,59}$/;

function publicProgress(value: unknown): JobProgress | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.stage !== "string" || !STAGE.test(raw.stage)) return null;
  const count = (n: unknown) =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
  return { stage: raw.stage, done: count(raw.done), total: count(raw.total) };
}

export function toJobView(job: JobViewSource): JobView {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    propertyId: job.propertyId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    progress: job.status === "RUNNING" ? publicProgress(job.progress) : null,
    result:
      job.status === "SUCCEEDED" && job.result && typeof job.result === "object"
        ? (job.result as Record<string, unknown>)
        : null,
    error:
      job.errorCode && job.status !== "SUCCEEDED"
        ? { code: job.errorCode, message: job.errorMessage ?? "The job failed" }
        : null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    runAfter: job.status === "QUEUED" ? job.runAfter.toISOString() : null,
  };
}
