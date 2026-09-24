"use client";

import { useState } from "react";
import { RoomReadinessBadge } from "@/components/front-desk/RoomStatusBadges";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useProperty } from "@/hooks/useProperty";
import {
  useHousekeepingTasksQuery,
  useWorkHousekeepingTaskMutation,
} from "@/lib/api/endpoints/housekeeping.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDateTime, formatShortDate } from "@/lib/utils/format";
import type { TaskView } from "@/modules/housekeeping/housekeeping.types";
import { AssignTaskDialog, CloseTaskDialog, InspectTaskDialog } from "./TaskDialogs";

const PAGE_SIZE = 50;

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "To clean", tone: "warning" },
  IN_PROGRESS: { label: "Cleaning", tone: "info" },
  PAUSED: { label: "Paused", tone: "neutral" },
  COMPLETED: { label: "Cleaned", tone: "success" },
  INSPECTED: { label: "Inspected", tone: "success" },
  FAILED_INSPECTION: { label: "Failed inspection", tone: "danger" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const PRIORITY_TONE: Record<string, BadgeTone> = {
  URGENT: "danger",
  PRIORITY: "warning",
  NORMAL: "neutral",
};

const EMPTY: Record<string, string> = {
  mine: "No open tasks are assigned to you.",
  open: "No open housekeeping tasks.",
  inspections: "No cleaned rooms are waiting for inspection.",
  all: "No housekeeping tasks for the business date.",
};

type DialogState = { kind: "assign" | "skip" | "cancel" | "inspect"; task: TaskView } | null;

/** Cursor-paged task cards (phone friendly) with the actions the server allows. */
export function TaskList({ view }: { view: "mine" | "open" | "inspections" | "all" }) {
  const [cursors, setCursors] = useState<{ view: string; list: (string | undefined)[] }>({
    view,
    list: [undefined],
  });
  const list = cursors.view === view ? cursors.list : [undefined];
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <div className="flex flex-col gap-2">
      {list.map((cursor, index) => (
        <TaskPage
          key={`${view}-${cursor ?? "first"}`}
          view={view}
          cursor={cursor}
          first={index === 0}
          isLast={index === list.length - 1}
          onLoadMore={(next) => setCursors({ view, list: [...list, next] })}
          onDialog={setDialog}
        />
      ))}
      {dialog?.kind === "assign" ? (
        <AssignTaskDialog task={dialog.task} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "skip" || dialog?.kind === "cancel" ? (
        <CloseTaskDialog task={dialog.task} action={dialog.kind} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "inspect" ? (
        <InspectTaskDialog task={dialog.task} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function TaskPage({
  view,
  cursor,
  first,
  isLast,
  onLoadMore,
  onDialog,
}: {
  view: string;
  cursor: string | undefined;
  first: boolean;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
  onDialog: (state: DialogState) => void;
}) {
  const property = useProperty();
  const { data, isLoading, isFetching, error, refetch } = useHousekeepingTasksQuery(
    { propertyId: property.id, view, cursor, limit: String(PAGE_SIZE) },
    { pollingInterval: first ? 60_000 : 0, skipPollingIfUnfocused: true },
  );
  const apiError = toClientApiError(error);

  if (isLoading) return <StatusPanel kind="loading" title="Loading tasks" />;
  if (apiError) {
    return (
      <StatusPanel
        kind="error"
        title="Could not load tasks"
        description={apiError.message}
        requestId={apiError.requestId}
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!data || (data.items.length === 0 && first)) {
    return <StatusPanel kind="empty" title={EMPTY[view] ?? "No tasks."} />;
  }
  return (
    <>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {data.items.map((task) => (
          <li key={task.id}>
            <TaskCard task={task} onDialog={onDialog} />
          </li>
        ))}
      </ul>
      {isLast && data.meta.nextCursor ? (
        <div className="text-center">
          <Button
            variant="secondary"
            size="sm"
            pending={isFetching}
            onClick={() => onLoadMore(data.meta.nextCursor!)}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function TaskCard({ task, onDialog }: { task: TaskView; onDialog: (state: DialogState) => void }) {
  const property = useProperty();
  const [work, { isLoading, error, originalArgs }] = useWorkHousekeepingTaskMutation();
  const apiError = toClientApiError(error);
  const status = STATUS[task.status] ?? { label: task.status, tone: "neutral" as const };
  const act = (action: "start" | "pause" | "complete") =>
    void work({
      propertyId: property.id,
      taskId: task.id,
      action,
      body: { version: task.version },
    });
  const pending = (action: string) => isLoading && originalArgs?.action === action;
  const a = task.allowedActions;

  return (
    <article className="flex h-full flex-col gap-2 rounded-md border border-border-subtle bg-surface p-3">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-semibold">Room {task.room.number}</span>
        <span className="text-xs text-fg-muted">
          {task.room.roomTypeCode}
          {task.room.floor ? ` · ${task.room.floor}` : ""}
        </span>
        <span className="ms-auto flex gap-1">
          {task.priority !== "NORMAL" ? (
            <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority.toLowerCase()}</Badge>
          ) : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </header>
      <p className="text-sm">
        {task.type.name}
        {task.arrivingToday ? (
          <span className="font-medium text-danger"> · guest arriving today</span>
        ) : null}
      </p>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-secondary">
        {task.room.frontOfficeStatus === "OCCUPIED" ? "Occupied" : "Vacant"} · room{" "}
        {task.room.housekeepingStatus.toLowerCase()}
        <RoomReadinessBadge readiness={task.room.readiness} />
      </p>
      <p className="text-xs text-fg-secondary">
        {task.attendant
          ? `Attendant: ${task.attendant.name}${task.mine ? " (you)" : ""}`
          : "Unassigned"}
        {task.businessDate !== undefined ? ` · for ${formatShortDate(task.businessDate)}` : ""}
      </p>
      {task.completedAt ? (
        <p className="text-xs text-fg-muted">
          Cleaned {formatDateTime(task.completedAt, property.timezone)}
          {task.completedBy ? ` by ${task.completedBy}` : ""}
          {task.inspectedAt
            ? ` · inspected ${formatDateTime(task.inspectedAt, property.timezone)}${task.inspectedBy ? ` by ${task.inspectedBy}` : ""}`
            : task.awaitingInspection
              ? " · waiting for inspection"
              : ""}
        </p>
      ) : null}
      {task.notes ? <p className="text-xs text-fg-muted">{task.notes}</p> : null}
      {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {a.start ? (
          <Button size="touch" pending={pending("start")} onClick={() => act("start")}>
            {task.status === "PENDING" && !task.attendant ? "Take & start" : "Start"}
          </Button>
        ) : null}
        {a.complete ? (
          <Button size="touch" pending={pending("complete")} onClick={() => act("complete")}>
            Complete
          </Button>
        ) : null}
        {a.pause ? (
          <Button
            size="touch"
            variant="secondary"
            pending={pending("pause")}
            onClick={() => act("pause")}
          >
            Pause
          </Button>
        ) : null}
        {a.inspect ? (
          <Button size="touch" onClick={() => onDialog({ kind: "inspect", task })}>
            Inspect
          </Button>
        ) : null}
        {a.assign ? (
          <Button
            size="touch"
            variant="secondary"
            onClick={() => onDialog({ kind: "assign", task })}
          >
            {task.attendant ? "Reassign" : "Assign"}
          </Button>
        ) : null}
        {a.skip ? (
          <Button size="touch" variant="ghost" onClick={() => onDialog({ kind: "skip", task })}>
            Skip
          </Button>
        ) : null}
        {a.cancel ? (
          <Button size="touch" variant="ghost" onClick={() => onDialog({ kind: "cancel", task })}>
            Cancel
          </Button>
        ) : null}
        {isLoading ? <Spinner label="Saving" /> : null}
      </div>
    </article>
  );
}
