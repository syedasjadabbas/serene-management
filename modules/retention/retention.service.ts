import "server-only";
import type { Db } from "@/lib/db/prisma";
import {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  RETENTION_DAYS,
  RETENTION_TARGETS,
  type RetentionTarget,
  retentionCutoff,
} from "./retention.policy";
import { countEligible, countPendingOutbox, deleteBatch } from "./retention.repository";

export interface RetentionOptions {
  /** Reference time for the cutoffs (tests pin it). */
  now?: Date;
  /** Count what would be removed without deleting anything. */
  dryRun?: boolean;
  batchSize?: number;
  /** Safety stop per target; a later run continues where this one ended. */
  maxBatches?: number;
}

export interface RetentionTargetResult {
  target: RetentionTarget;
  retentionDays: number;
  cutoff: string;
  /** Rows removed (0 in a dry run). */
  deleted: number;
  /** Rows eligible at the start (dry run) — null when deleting. */
  eligible: number | null;
  /** True when maxBatches stopped the target before it was drained. */
  truncated: boolean;
}

export interface RetentionReport {
  dryRun: boolean;
  batchSize: number;
  targets: RetentionTargetResult[];
  /** Outbox events waiting for a publisher: retained, reported only. */
  pendingOutboxRetained: number;
}

/**
 * Prunes transient operational data per retention.policy (H6). Safe to run
 * repeatedly and concurrently with the application: batches are separate
 * statements, locked rows are skipped, and a second run finds nothing left.
 * Reports counts only — never row contents.
 */
export async function runRetention(
  db: Pick<Db, "$executeRaw" | "$queryRaw">,
  options: RetentionOptions = {},
): Promise<RetentionReport> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE) {
    throw new RangeError(
      `batchSize must be an integer from ${MIN_BATCH_SIZE} to ${MAX_BATCH_SIZE}`,
    );
  }
  const maxBatches = options.maxBatches ?? 10_000;

  const targets: RetentionTargetResult[] = [];
  for (const target of RETENTION_TARGETS) {
    const cutoff = retentionCutoff(target, now);
    const result: RetentionTargetResult = {
      target,
      retentionDays: RETENTION_DAYS[target],
      cutoff: cutoff.toISOString(),
      deleted: 0,
      eligible: null,
      truncated: false,
    };
    if (dryRun) {
      result.eligible = await countEligible(db, target, cutoff);
    } else {
      for (let batch = 0; ; batch++) {
        if (batch >= maxBatches) {
          result.truncated = true;
          break;
        }
        const removed = await deleteBatch(db, target, cutoff, batchSize);
        result.deleted += removed;
        if (removed < batchSize) break;
      }
    }
    targets.push(result);
  }
  return { dryRun, batchSize, targets, pendingOutboxRetained: await countPendingOutbox(db) };
}
