import { z } from "zod";
import {
  type TaskPriority,
  scheduleProblem,
} from "@serene/shared/modules/housekeeping/housekeeping.policy";

export interface AddTaskValues {
  roomId: string;
  taskTypeId: string;
  description: string;
  priority: TaskPriority;
  assigneeId: string;
  date: string;
  time: string;
  notes: string;
}

/** Add-task form: room and type required, description 3+ chars when given, date inside the schedule window. */
export function addTaskFormSchema(businessDate: string, maxDate: string) {
  return z
    .object({
      roomId: z.string().min(1, "Select a room"),
      taskTypeId: z.string().min(1, "Select a task type"),
      description: z.string(),
      priority: z.enum(["NORMAL", "PRIORITY", "URGENT"]),
      assigneeId: z.string(),
      date: z.string(),
      time: z.string(),
      notes: z.string(),
    })
    .superRefine((v, ctx) => {
      const d = v.description.trim();
      if (d.length > 0 && d.length < 3) {
        ctx.addIssue({
          code: "custom",
          path: ["description"],
          message: "Use at least 3 characters",
        });
      }
      const problem = v.date ? scheduleProblem(v.date, businessDate, maxDate) : "Choose a date";
      if (problem) ctx.addIssue({ code: "custom", path: ["date"], message: problem });
    });
}

export function addTaskDefaults(businessDate: string): AddTaskValues {
  return {
    roomId: "",
    taskTypeId: "",
    description: "",
    priority: "NORMAL",
    assigneeId: "",
    date: businessDate,
    time: "",
    notes: "",
  };
}

/** API body: optional parts only when filled; `scheduledDate` only when not the business date. */
export function addTaskBody(v: AddTaskValues, businessDate: string) {
  return {
    roomId: v.roomId,
    taskTypeId: v.taskTypeId,
    priority: v.priority,
    ...(v.description.trim() ? { description: v.description.trim() } : {}),
    ...(v.assigneeId ? { assigneeId: v.assigneeId } : {}),
    ...(v.date !== businessDate ? { scheduledDate: v.date } : {}),
    ...(v.time ? { scheduledTime: v.time } : {}),
    ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
  };
}
