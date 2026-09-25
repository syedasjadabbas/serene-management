import type { CheckOutcome, CheckStep, StepCode, StepStatus } from "./night-audit.policy";

export type Money = string;

/** One row a check lists (e.g. a guest still due out). */
export interface CheckItem {
  label: string;
  detail: string | null;
  /** Where the clerk resolves it. */
  link: { kind: "stay" | "reservation" | "folio" | "room"; id: string } | null;
}

export interface CheckResult {
  code: CheckStep;
  label: string;
  outcome: CheckOutcome;
  message: string;
  count: number;
  items: CheckItem[];
}

export interface RunUserView {
  id: string;
  name: string;
}

export interface RunStepView {
  sequence: number;
  code: StepCode;
  label: string;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
}

export interface NightAuditSummary {
  businessDate: string;
  nextBusinessDate: string | null;
  roomsPosted: number;
  nightsPosted: number;
  linesPosted: number;
  chargesPosted: Money;
  taxesPosted: Money;
  noShows: number;
  noShowFees: number;
  noShowFeeTotal: Money;
  blocksReleased: number;
  blocksActivated: number;
  groupCutoffs: number;
  roomsRolledToDirty: number;
  tasksCancelled: number;
  tasksCreated: number;
  inventoryRepairs: number;
}

export interface RunView {
  id: string;
  businessDate: string;
  attempt: number;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  startedBy: RunUserView | null;
  errorCode: string | null;
  errorMessage: string | null;
  summary: NightAuditSummary | null;
  steps: RunStepView[];
  actions: { recover: boolean };
}

export interface RunListItem {
  id: string;
  businessDate: string;
  attempt: number;
  status: RunView["status"];
  startedAt: string;
  finishedAt: string | null;
  startedBy: RunUserView | null;
  errorCode: string | null;
}

export interface ReadinessView {
  businessDate: string | null;
  status: "OPEN" | "IN_AUDIT" | "NOT_INITIALIZED";
  propertyLocalDate: string;
  /** Why the audit cannot start now (null when it can). */
  startProblem: string | null;
  canStart: boolean;
  checks: CheckResult[];
  running: RunListItem | null;
  lastRun: RunListItem | null;
  actions: { run: boolean };
}
