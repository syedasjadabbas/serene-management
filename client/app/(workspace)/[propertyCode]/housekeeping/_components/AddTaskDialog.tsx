"use client";

import { BedDouble } from "lucide-react";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useCreateHousekeepingTaskMutation,
  useHousekeepingOptionsQuery,
} from "@/global/api/endpoints/housekeepingApi";
import { useRoomPickerQuery } from "@/global/api/endpoints/roomsApi";
import { toClientApiError } from "@/global/api/errors";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import {
  MAX_SCHEDULE_DAYS,
  type TaskPriority,
} from "@serene/shared/modules/housekeeping/housekeeping.policy";
import type { TaskView } from "@serene/shared/modules/housekeeping/housekeeping.types";
import {
  type AddTaskValues,
  addTaskBody,
  addTaskDefaults,
  addTaskFormSchema,
} from "../_lib/addTaskForm";

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
  const { control, handleSubmit, setError, formState } = useZodForm(
    addTaskFormSchema(businessDate, maxDate),
    addTaskDefaults(businessDate),
  );
  const [create, { isLoading, error }] = useCreateHousekeepingTaskMutation();
  const apiError = toClientApiError(error);

  const submit = async (values: AddTaskValues) => {
    const result = await create({
      propertyId: property.id,
      body: addTaskBody(values, businessDate),
    });
    if ("data" in result && result.data) onCreated(result.data);
    else if ("error" in result) {
      const failed = toClientApiError(result.error);
      if (failed) {
        const { scheduledDate, scheduledTime, ...rest } = failed.fieldErrors;
        applyServerError(setError, {
          ...failed,
          fieldErrors: {
            ...rest,
            ...(scheduledDate ? { date: scheduledDate } : {}),
            ...(scheduledTime ? { time: scheduledTime } : {}),
          },
        });
      }
    }
  };

  return (
    <FormDialog
      title="Add housekeeping task"
      description="For a room, today or scheduled for a later date."
      size="lg"
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Add task"
      pending={isLoading || formState.isSubmitting}
      error={apiError}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="roomId"
          label="Room"
          placeholder={rooms.data ? "Select a room" : "Loading rooms…"}
          options={(rooms.data ?? []).map((r) => ({
            value: r.id,
            label: `Room ${r.number}`,
            description: r.roomTypeCode,
            icon: BedDouble,
          }))}
        />
        <FormSelect
          control={control}
          name="taskTypeId"
          label="Task type"
          placeholder={options.data ? "Select a type" : "Loading…"}
          options={(options.data?.taskTypes ?? []).map((t) => ({
            value: t.id,
            label: t.name,
            description: t.requiresInspection
              ? `${t.code} · needs inspection`
              : `${t.code} · about ${t.estimatedMinutes} min`,
          }))}
        />
      </div>
      <FormTextField
        control={control}
        name="description"
        label="Description (optional)"
        maxLength={200}
        placeholder="e.g. Replace the curtains, deep clean the bathroom"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect control={control} name="priority" label="Priority" options={PRIORITIES} />
        <FormSelect
          control={control}
          name="assigneeId"
          label="Assign to (optional)"
          placeholder="Unassigned"
          options={(options.data?.assignees ?? []).map((a) => ({
            value: a.id,
            label: a.displayName,
          }))}
          hint="Users who can do housekeeping work at this property"
        />
        <FormTextField
          control={control}
          name="date"
          label="Date"
          type="date"
          min={businessDate}
          max={maxDate}
          hint={`Business date ${businessDate} up to ${maxDate}`}
        />
        <FormTextField
          control={control}
          name="time"
          label="Time (optional)"
          type="time"
          hint="Target time, property local"
        />
      </div>
      <FormTextArea control={control} name="notes" label="Notes (optional)" maxLength={2000} />
    </FormDialog>
  );
}
