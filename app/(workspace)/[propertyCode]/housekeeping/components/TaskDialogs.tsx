"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { useProperty } from "@/hooks/useProperty";
import {
  useAssignHousekeepingTaskMutation,
  useCloseHousekeepingTaskMutation,
  useHousekeepingOptionsQuery,
} from "@/lib/api/endpoints/housekeeping.api";
import { useInspectRoomMutation } from "@/lib/api/endpoints/rooms.api";
import { toClientApiError } from "@/lib/api/errors";
import type { TaskView } from "@/modules/housekeeping/housekeeping.types";

/** Assign (or reassign / unassign) a task to a housekeeping user of the property. */
export function AssignTaskDialog({ task, onClose }: { task: TaskView; onClose: () => void }) {
  const property = useProperty();
  const options = useHousekeepingOptionsQuery(property.id);
  const [assigneeId, setAssigneeId] = useState(task.attendant?.userId ?? "");
  const [assign, { isLoading, error }] = useAssignHousekeepingTaskMutation();
  const apiError = toClientApiError(error);
  const submit = async () => {
    const result = await assign({
      propertyId: property.id,
      taskId: task.id,
      body: { version: task.version, assigneeId: assigneeId || null },
    });
    if ("data" in result) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Assign room ${task.room.number}`}
      description={task.type.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            pending={isLoading}
            disabled={(assigneeId || null) === (task.attendant?.userId ?? null)}
            onClick={() => void submit()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <Select
          label="Attendant"
          placeholder="Unassigned"
          options={(options.data?.assignees ?? []).map((a) => ({
            value: a.id,
            label: a.displayName,
          }))}
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          hint="Users who can do housekeeping work at this property"
        />
      </div>
    </Dialog>
  );
}

/** Skip (service declined) or cancel a task, with a reason. */
export function CloseTaskDialog({
  task,
  action,
  onClose,
}: {
  task: TaskView;
  action: "skip" | "cancel";
  onClose: () => void;
}) {
  const property = useProperty();
  const [reason, setReason] = useState("");
  const [close, { isLoading, error }] = useCloseHousekeepingTaskMutation();
  const apiError = toClientApiError(error);
  const submit = async () => {
    const result = await close({
      propertyId: property.id,
      taskId: task.id,
      action,
      body: { version: task.version, reason: reason.trim() },
    });
    if ("data" in result) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${action === "skip" ? "Skip" : "Cancel"} room ${task.room.number}`}
      description={task.type.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="danger"
            pending={isLoading}
            disabled={reason.trim().length < 3}
            onClick={() => void submit()}
          >
            {action === "skip" ? "Skip task" : "Cancel task"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <TextArea
          label={action === "skip" ? "Why (e.g. guest declined service)" : "Reason"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
        />
      </div>
    </Dialog>
  );
}

/** Pass or fail the inspection of a cleaned room. */
export function InspectTaskDialog({ task, onClose }: { task: TaskView; onClose: () => void }) {
  const property = useProperty();
  const [outcome, setOutcome] = useState<"PASS" | "FAIL">("PASS");
  const [notes, setNotes] = useState("");
  const [inspect, { isLoading, error }] = useInspectRoomMutation();
  const apiError = toClientApiError(error);
  const submit = async () => {
    const result = await inspect({
      propertyId: property.id,
      roomId: task.room.id,
      body: {
        version: task.room.version,
        outcome,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
    });
    if ("data" in result) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Inspect room ${task.room.number}`}
      description={`${task.type.name}${task.completedBy ? ` · cleaned by ${task.completedBy}` : ""}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={outcome === "FAIL" ? "danger" : "primary"}
            pending={isLoading}
            disabled={outcome === "FAIL" && notes.trim().length < 3}
            onClick={() => void submit()}
          >
            {outcome === "PASS" ? "Pass: room ready" : "Fail: back to attendant"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <Select
          label="Outcome"
          options={[
            { value: "PASS", label: "Pass" },
            { value: "FAIL", label: "Fail" },
          ]}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as "PASS" | "FAIL")}
        />
        <TextArea
          label={outcome === "FAIL" ? "What needs redoing (required)" : "Notes (optional)"}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
        />
      </div>
    </Dialog>
  );
}
