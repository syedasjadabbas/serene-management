/**
 * Night audit rules (docs/PMS_WORKFLOWS.md §26, DOMAIN_MODEL §6.9–6.10).
 * Pure: no database access.
 *
 * Run:  RUNNING → COMPLETED | FAILED (terminal; a retry is a new run).
 * Date: OPEN → IN_AUDIT → CLOSED (next date OPEN in the same transaction),
 *       or IN_AUDIT → OPEN when the run fails. A closed date never reopens.
 */

/** Phase B: read-only checks, in order. */
export const CHECK_STEPS = [
  "VALIDATE_DEPARTURES",
  "VALIDATE_ARRIVALS",
  "VALIDATE_BALANCES",
  "VALIDATE_PAYMENTS",
  "VALIDATE_ROOM_STATUS",
  "VALIDATE_POSTING",
  "VALIDATE_CASHIERS",
] as const;

/** Phase C: one transaction, in order. */
export const COMMIT_STEPS = [
  "POST_ROOM_AND_TAX",
  "PROCESS_NO_SHOWS",
  "RELEASE",
  "ROOM_STATUS_ROLL",
  "RECONCILE_INVENTORY",
  "STATISTICS",
  "CLOSE_DATE",
] as const;

export type CheckStep = (typeof CHECK_STEPS)[number];
export type CommitStep = (typeof COMMIT_STEPS)[number];
export type StepCode = CheckStep | CommitStep;

export const STEP_LABELS: Record<StepCode, string> = {
  VALIDATE_DEPARTURES: "Departures",
  VALIDATE_ARRIVALS: "Arrivals",
  VALIDATE_BALANCES: "Folio balances",
  VALIDATE_PAYMENTS: "Payments",
  VALIDATE_ROOM_STATUS: "Room status",
  VALIDATE_POSTING: "Room charges",
  VALIDATE_CASHIERS: "Cashiers",
  POST_ROOM_AND_TAX: "Post room, package and tax charges",
  PROCESS_NO_SHOWS: "Process no-shows",
  RELEASE: "Release blocks",
  ROOM_STATUS_ROLL: "Room status and housekeeping",
  RECONCILE_INVENTORY: "Reconcile inventory",
  STATISTICS: "Statistics",
  CLOSE_DATE: "Close the business date",
};

/**
 * Outcome of a check: PASSED and WARNING let the audit continue, BLOCKING
 * stops it before anything is posted, SKIPPED is a check that does not
 * apply (cashiering is not enabled, D34).
 */
export type CheckOutcome = "PASSED" | "WARNING" | "BLOCKING" | "SKIPPED";

export type StepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export function stepStatusOf(outcome: CheckOutcome): StepStatus {
  switch (outcome) {
    case "BLOCKING":
      return "FAILED";
    case "SKIPPED":
      return "SKIPPED";
    default:
      return "SUCCEEDED";
  }
}

export function isBlocking(outcomes: readonly { outcome: CheckOutcome }[]): boolean {
  return outcomes.some((check) => check.outcome === "BLOCKING");
}

/**
 * Whether the property's current business date may be closed now. A date
 * ahead of the hotel's local calendar date would roll the hotel into the
 * future; the audit runs on the date itself (late evening) or after it.
 */
export function closeDateProblem(businessDate: string, propertyLocalDate: string): string | null {
  return businessDate > propertyLocalDate
    ? `The business date ${businessDate} is ahead of the hotel's local date ${propertyLocalDate}`
    : null;
}

/**
 * A RUNNING run older than this may be recovered. Recovery also takes the
 * business date with NOWAIT, so it can never interrupt a commit in progress.
 */
export const STALE_RUN_MS = 2 * 60_000;

export function isStaleRun(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() >= STALE_RUN_MS;
}

/** How many rows a check lists (the count is always exact). */
export const CHECK_ITEM_LIMIT = 50;
