/**
 * Pure housekeeping rules (isomorphic, unit-tested): the task state machine,
 * who may act on a task, when a cleaned room waits for inspection, and
 * priorities (docs/DOMAIN_MODEL.md §6.6, docs/PMS_WORKFLOWS.md §13).
 */

export const TASK_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "PAUSED",
  "COMPLETED",
  "INSPECTED",
  "FAILED_INSPECTION",
  "SKIPPED",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Tasks that still need an attendant. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "PAUSED",
  "FAILED_INSPECTION",
];

export type TaskAction = "assign" | "start" | "pause" | "complete" | "skip" | "cancel";

/**
 * Task state machine. Inspection outcomes (COMPLETED → INSPECTED /
 * FAILED_INSPECTION) are driven by the room inspection command.
 */
export function taskTransition(
  action: TaskAction,
  status: TaskStatus,
): { next: TaskStatus } | { problem: string } {
  const label = status.toLowerCase().replace("_", " ");
  switch (action) {
    case "assign":
      return OPEN_TASK_STATUSES.includes(status)
        ? { next: status }
        : { problem: `A ${label} task cannot be reassigned` };
    case "start":
      return status === "PENDING" || status === "PAUSED" || status === "FAILED_INSPECTION"
        ? { next: "IN_PROGRESS" }
        : { problem: `A ${label} task cannot be started` };
    case "pause":
      return status === "IN_PROGRESS"
        ? { next: "PAUSED" }
        : { problem: "Only a task in progress can be paused" };
    case "complete":
      return status === "IN_PROGRESS"
        ? { next: "COMPLETED" }
        : { problem: "Start the task before completing it" };
    case "skip":
      return status === "PENDING" || status === "PAUSED"
        ? { next: "SKIPPED" }
        : { problem: `A ${label} task cannot be skipped` };
    case "cancel":
      return status === "PENDING" || status === "PAUSED" || status === "FAILED_INSPECTION"
        ? { next: "CANCELLED" }
        : { problem: `A ${label} task cannot be cancelled` };
  }
}

/**
 * Who may work a task: the assigned attendant, or a supervisor
 * (`housekeeping:assign`). Anyone with `housekeeping:update` may pick up an
 * unassigned task (starting it assigns it to them).
 */
export function taskActorProblem(
  action: "start" | "pause" | "complete" | "skip",
  task: { assigneeUserId: string | null },
  actor: { userId: string; canManage: boolean },
): string | null {
  if (actor.canManage) return null;
  if (task.assigneeUserId === actor.userId) return null;
  if (task.assigneeUserId === null && action === "start") return null;
  return task.assigneeUserId === null
    ? "Start the task first to take it"
    : "This task is assigned to another attendant";
}

/**
 * A completed cleaning waits for inspection when the task type asks for it
 * or the property only accepts inspected rooms for check-in.
 */
export function needsInspection(input: {
  typeRequiresInspection: boolean;
  propertyRequiresInspected: boolean;
}): boolean {
  return input.typeRequiresInspection || input.propertyRequiresInspected;
}

export const TASK_PRIORITIES = ["URGENT", "PRIORITY", "NORMAL"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Stored priority (lower = sooner, see housekeeping_tasks.priority). */
export const PRIORITY_VALUES: Record<TaskPriority, number> = {
  URGENT: 10,
  PRIORITY: 50,
  NORMAL: 100,
};

export function priorityLabel(value: number): TaskPriority {
  if (value <= PRIORITY_VALUES.URGENT) return "URGENT";
  if (value <= PRIORITY_VALUES.PRIORITY) return "PRIORITY";
  return "NORMAL";
}

/**
 * Priority of a cleaning created by the system: a room a guest arrives in
 * today is urgent; a room back from maintenance or out of order is a
 * priority; everything else is normal.
 */
export function cleaningPriority(input: {
  arrivingToday: boolean;
  afterMaintenance: boolean;
}): TaskPriority {
  if (input.arrivingToday) return "URGENT";
  if (input.afterMaintenance) return "PRIORITY";
  return "NORMAL";
}

export const TASK_VIEWS = ["all", "mine", "inspections", "open"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
