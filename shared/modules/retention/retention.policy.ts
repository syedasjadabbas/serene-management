/**
 * Retention policy for transient operational data (Phase 10, H6;
 * docs/OPERATIONS.md §5, docs/ARCHITECTURE.md D50). Applied by
 * `npm run ops:maintenance`. Ledgers, audit logs and business records are
 * never pruned; only rows that exist for a bounded technical purpose are.
 *
 * Conservative by design: each window is well past the point where the row
 * can still matter to the application.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION_DAYS = {
  /** Sessions past expiry or revocation. The session list shows only live ones. */
  authSessions: 30,
  /** Reset tokens past expiry or use (tokens live 30 minutes). */
  passwordResetTokens: 7,
  /** Idempotency keys past their 24-hour replay window. */
  idempotencyKeys: 7,
  /** Outbox events delivered by a publisher. */
  outboxPublished: 30,
  /** Outbox events a publisher gave up on (kept longer for investigation). */
  outboxFailed: 90,
  /** Rate-limit windows that ended (a window lasts at most an hour). */
  rateLimitWindows: 1,
  /**
   * Finished background jobs (SUCCEEDED, FAILED, CANCELLED). What they did is
   * on record elsewhere (the night audit run and the audit log); the job row
   * only served the requester's status page and investigation.
   */
  backgroundJobs: 30,
} as const;

/**
 * PENDING outbox events are never pruned: no publisher exists yet (D40), so
 * they are the only record of events a future integration must still
 * deliver. A future publisher defines their lifecycle.
 */
export const OUTBOX_PENDING_RETAINED = true;

export type RetentionTarget =
  | "authSessions"
  | "passwordResetTokens"
  | "idempotencyKeys"
  | "outboxPublished"
  | "outboxFailed"
  | "rateLimitWindows"
  | "backgroundJobs";

export const RETENTION_TARGETS: readonly RetentionTarget[] = [
  "authSessions",
  "passwordResetTokens",
  "idempotencyKeys",
  "outboxPublished",
  "outboxFailed",
  "rateLimitWindows",
  "backgroundJobs",
];

/** Rows older than the cutoff (their expiry, revocation, use or publication) are removed. */
export function retentionCutoff(target: RetentionTarget, now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS[target] * DAY_MS);
}

export const DEFAULT_BATCH_SIZE = 1_000;
export const MIN_BATCH_SIZE = 10;
export const MAX_BATCH_SIZE = 10_000;
