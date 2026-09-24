import { z } from "zod";
import { cursorPageQuerySchema, idSchema, isoDateSchema } from "@/lib/validation/common";
import { MAINTENANCE_PRIORITIES, MAINTENANCE_VIEWS } from "./maintenance.policy";

export const requestParamsSchema = z.object({ propertyId: idSchema, requestId: idSchema }).strict();

const version = z.number().int().positive();
const note = z.string().trim().max(4000).optional();
const reason = z.string().trim().min(3).max(1000);

export const requestsQuerySchema = cursorPageQuerySchema
  .extend({
    view: z.enum(MAINTENANCE_VIEWS).default("open"),
    priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
    roomId: idSchema.optional(),
    q: z.string().trim().min(2).max(100).optional(),
  })
  .strict();
export type RequestsQuery = z.infer<typeof requestsQuerySchema>;

/** Take the room out of order / out of service while the work is open (`rooms:out_of_order`). */
const blockRoomSchema = z
  .object({
    kind: z.enum(["OUT_OF_ORDER", "OUT_OF_SERVICE"]),
    to: isoDateSchema,
    reasonCodeId: idSchema,
  })
  .strict();

export const createRequestSchema = z
  .object({
    roomId: idSchema.optional(),
    location: z.string().trim().min(2).max(200).optional(),
    categoryId: idSchema,
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(4000).optional(),
    priority: z.enum(MAINTENANCE_PRIORITIES).default("NORMAL"),
    assigneeId: idSchema.optional(),
    blockRoom: blockRoomSchema.optional(),
    reason: reason.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.roomId && !value.location) {
      ctx.addIssue({ code: "custom", path: ["roomId"], message: "Choose a room or a location" });
    }
    if (value.blockRoom && !value.roomId) {
      ctx.addIssue({ code: "custom", path: ["blockRoom"], message: "Only a room can be blocked" });
    }
    if (value.blockRoom && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A reason is required to take the room out of use",
      });
    }
  });
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const assignRequestSchema = z.object({ version, assigneeId: idSchema, note }).strict();
export type AssignRequestInput = z.infer<typeof assignRequestSchema>;

export const requestCommandSchema = z.object({ version, note }).strict();
export type RequestCommandInput = z.infer<typeof requestCommandSchema>;

/**
 * Resolve: a resolution is required. `returnToService` releases the room
 * blocks placed for this request (the room comes back dirty with a cleaning
 * task; it is not ready until cleaned and, where required, inspected).
 */
export const resolveRequestSchema = z
  .object({
    version,
    resolution: z.string().trim().min(3).max(4000),
    returnToService: z.boolean().default(true),
  })
  .strict();
export type ResolveRequestInput = z.infer<typeof resolveRequestSchema>;

export const cancelRequestSchema = z.object({ version, reason }).strict();
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;

export const blockRequestRoomSchema = blockRoomSchema.extend({ version, reason }).strict();
export type BlockRequestRoomInput = z.infer<typeof blockRequestRoomSchema>;

export const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();
export type NoteInput = z.infer<typeof noteSchema>;
