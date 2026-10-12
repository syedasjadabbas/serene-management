"use client";

import { BedDouble } from "lucide-react";
import { useState } from "react";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import {
  useCreateHousekeepingTaskMutation,
  useHousekeepingOptionsQuery,
} from "@/lib/api/endpoints/housekeeping.api";
import { useRoomPickerQuery } from "@/lib/api/endpoints/rooms.api";
import { toClientApiError } from "@/lib/api/errors";
import { addDays } from "@/modules/business-date/business-date.policy";
import {
  MAX_SCHEDULE_DAYS,
  type TaskPriority,
  scheduleProblem,
} from "@/modules/housekeeping/housekeeping.policy";
import type { TaskView } from "@/modules/housekeeping/housekeeping.types";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "NORMAL", label: "Normal" },
  { value: "PRIORITY", label: "Priority" },
  { value: "URGENT", label: "Urgent" },
];

/**
 * Housekeeping → Add task: a task for a room, today or scheduled up to
 * MAX_SCHEDULE_DAYS ahead, optionally assigned. The server re-checks the
 * room, type, assignee, date and `housekeeping:assign`; this form only
 * mirrors the date range so the obvious mistakes never leave the page.
 */
export function AddTaskDialog({
  businessDate,
  onClose,
  onCreated,
}: {
  businessDate: string;
  onClose: () => void;
  onCreated: (task: TaskView) => void;
}) {
  const property = useProperty();
  const options = useHousekeepingOptionsQuery(property.id);
  // A light list of rooms, not the whole room board (as in Report an issue).
  const rooms = useRoomPickerQuery(property.id);
  const maxDate = addDays(businessDate, MAX_SCHEDULE_DAYS);
  const [roomId, setRoomId] = useState("");
  const [taskTypeId, setTaskTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("NORMAL");
  const [assigneeId, setAssigneeId] = useState("");
  const [date, setDate] = useState(businessDate);
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [create, { isLoading, error }] = useCreateHousekeepingTaskMutation();
  const apiError = toClientApiError(error);
  const fields = apiError?.fieldErrors ?? {};

  const dateProblem = date ? scheduleProblem(date, businessDate, maxDate) : "Choose a date";
  const descriptionProblem =
    description.trim().length > 0 && description.trim().length < 3
      ? "Use at least 3 characters"
      : null;
  const invalid = !roomId || !taskTypeId || !!dateProblem || !!descriptionProblem;

  const submit = async () => {
    if (invalid) return;
    const result = await create({
      propertyId: property.id,
      body: {
        roomId,
        taskTypeId,
        priority,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(date !== businessDate ? { scheduledDate: date } : {}),
        ...(time ? { scheduledTime: time } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
    });
    if ("data" in result && result.data) onCreated(result.data);
  };

  return (
    <FormDialog
      title="Add housekeeping task"
      description="For a room, today or scheduled for a later date."
      size="lg"
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel="Add task"
      disabled={invalid}
      pending={isLoading}
      error={apiError}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Room"
          placeholder={rooms.data ? "Select a room" : "Loading rooms…"}
          options={(rooms.data ?? []).map((r) => ({
            value: r.id,
            label: `Room ${r.number}`,
            description: r.roomTypeCode,
            icon: BedDouble,
          }))}
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          errors={fields.roomId}
        />
        <Select
          label="Task type"
          placeholder={options.data ? "Select a type" : "Loading…"}
          options={(options.data?.taskTypes ?? []).map((t) => ({
            value: t.id,
            label: t.name,
            description: t.requiresInspection
              ? `${t.code} · needs inspection`
              : `${t.code} · about ${t.estimatedMinutes} min`,
          }))}
          value={taskTypeId}
          onChange={(e) => setTaskTypeId(e.target.value)}
          errors={fields.taskTypeId}
        />
      </div>
      <TextField
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={200}
        placeholder="e.g. Replace the curtains, deep clean the bathroom"
        errors={descriptionProblem ? [descriptionProblem] : fields.description}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Priority"
          options={PRIORITIES}
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
        />
        <Select
          label="Assign to (optional)"
          placeholder="Unassigned"
          options={(options.data?.assignees ?? []).map((a) => ({
            value: a.id,
            label: a.displayName,
          }))}
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          hint="Users who can do housekeeping work at this property"
          errors={fields.assigneeId}
        />
        <TextField
          label="Date"
          type="date"
          value={date}
          min={businessDate}
          max={maxDate}
          onChange={(e) => setDate(e.target.value)}
          hint={`Business date ${businessDate} up to ${maxDate}`}
          errors={date && dateProblem ? [dateProblem] : fields.scheduledDate}
        />
        <TextField
          label="Time (optional)"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          hint="Target time, property local"
          errors={fields.scheduledTime}
        />
      </div>
      <TextArea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
      />
    </FormDialog>
  );
}
