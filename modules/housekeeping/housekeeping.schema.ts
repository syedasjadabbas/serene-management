import { z } from "zod";
import { cursorPageQuerySchema, idSchema } from "@/lib/validation/common";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_VIEWS } from "./housekeeping.policy";

export const taskParamsSchema = z.object({ propertyId: idSchema, taskId: idSchema }).strict();
export const roomParamsSchema = z.object({ propertyId: idSchema, roomId: idSchema }).strict();

const version = z.number().int().positive();
const notes = z.string().trim().max(2000).optional();
const reasonText = z.string().trim().min(3).max(1000);

export const tasksQuerySchema = cursorPageQuerySchema
  .extend({
    view: z.enum(TASK_VIEWS).default("open"),
    status: z.enum(TASK_STATUSES).optional(),
    roomId: idSchema.optional(),
  })
  .strict();
export type TasksQuery = z.infer<typeof tasksQuerySchema>;

export const createTaskSchema = z
  .object({
    roomId: idSchema,
    taskTypeId: idSchema,
    priority: z.enum(TASK_PRIORITIES).default("NORMAL"),
    assigneeId: idSchema.optional(),
    notes,
  })
  .strict();
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Assign to a user holding housekeeping:update, or unassign with null. */
export const assignTaskSchema = z
  .object({ version, assigneeId: idSchema.nullable(), notes })
  .strict();
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;

export const taskCommandSchema = z.object({ version, notes }).strict();
export type TaskCommandInput = z.infer<typeof taskCommandSchema>;

export const closeTaskSchema = z.object({ version, reason: reasonText }).strict();
export type CloseTaskInput = z.infer<typeof closeTaskSchema>;

/** Inspection outcome; a failed inspection must say why. `version` is the room's. */
export const inspectRoomSchema = z
  .object({
    version,
    outcome: z.enum(["PASS", "FAIL"]),
    notes,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === "FAIL" && (!value.notes || value.notes.length < 3)) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Say what failed the inspection",
      });
    }
  });
export type InspectRoomInput = z.infer<typeof inspectRoomSchema>;

/** Room-level housekeeping corrections (mark dirty / mark clean). `version` is the room's. */
export const roomHousekeepingSchema = z.object({ version, notes }).strict();
export type RoomHousekeepingInput = z.infer<typeof roomHousekeepingSchema>;
