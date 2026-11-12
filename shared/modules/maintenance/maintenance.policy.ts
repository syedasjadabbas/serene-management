/**
 * Pure maintenance rules (isomorphic, unit-tested): the request state
 * machine, who may work a request, and priority ordering
 * (docs/DOMAIN_MODEL.md §6.7, docs/PMS_WORKFLOWS.md §29).
 */

export const MAINTENANCE_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const ACTIVE_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
];

/** Priorities, most urgent first ("critical" work is URGENT). */
export const MAINTENANCE_PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low",
};

export type MaintenanceAction =
  "assign" | "start" | "hold" | "resume" | "resolve" | "close" | "reopen" | "cancel";

export function maintenanceTransition(
  action: MaintenanceAction,
  status: MaintenanceStatus,
): { next: MaintenanceStatus } | { problem: string } {
  const label = status.toLowerCase().replace("_", " ");
  const allow = (from: MaintenanceStatus[], next: MaintenanceStatus) =>
    from.includes(status) ? { next } : { problem: `A ${label} request cannot be ${PAST[action]}` };
  switch (action) {
    case "assign":
      // Reassignment keeps the work status; a new request becomes ASSIGNED.
      return ACTIVE_MAINTENANCE_STATUSES.includes(status)
        ? { next: status === "OPEN" ? "ASSIGNED" : status }
        : { problem: `A ${label} request cannot be assigned` };
    case "start":
      return allow(["OPEN", "ASSIGNED"], "IN_PROGRESS");
    case "hold":
      return allow(["IN_PROGRESS"], "ON_HOLD");
    case "resume":
      return allow(["ON_HOLD"], "IN_PROGRESS");
    case "resolve":
      return allow(["IN_PROGRESS", "ON_HOLD"], "RESOLVED");
    case "close":
      return allow(["RESOLVED"], "CLOSED");
    case "reopen":
      return allow(["RESOLVED"], "IN_PROGRESS");
    case "cancel":
      return allow(["OPEN", "ASSIGNED", "ON_HOLD"], "CANCELLED");
  }
}

const PAST: Record<MaintenanceAction, string> = {
  assign: "assigned",
  start: "started",
  hold: "put on hold",
  resume: "resumed",
  resolve: "resolved",
  close: "closed",
  reopen: "reopened",
  cancel: "cancelled",
};

/**
 * Work on a request (start / hold / resume / resolve): the assignee, or a
 * manager (`maintenance:manage`). Starting an unassigned request takes it.
 */
export function maintenanceActorProblem(
  action: "start" | "hold" | "resume" | "resolve",
  request: { assigneeId: string | null },
  actor: { userId: string; canManage: boolean },
): string | null {
  if (actor.canManage) return null;
  if (request.assigneeId === actor.userId) return null;
  if (request.assigneeId === null && action === "start") return null;
  return "This request is assigned to someone else";
}

export const MAINTENANCE_VIEWS = [
  "open",
  "mine",
  "in_progress",
  "resolved",
  "closed",
  "all",
] as const;
export type MaintenanceView = (typeof MAINTENANCE_VIEWS)[number];
