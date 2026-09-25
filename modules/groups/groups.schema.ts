import { z } from "zod";
import {
  cursorPageQuerySchema,
  idSchema,
  isoDateSchema,
  localTimeSchema,
} from "@/lib/validation/common";
import { GROUP_STATUSES } from "./groups.policy";

/**
 * Group and block contracts (Phase 6). Clients never send pickup counts,
 * remaining rooms or prices: the server derives them from the allocation
 * grid, the source reservations and the block's rate plan.
 */

export const groupParamsSchema = z.object({ propertyId: idSchema, groupId: idSchema }).strict();
export const blockParamsSchema = z.object({ propertyId: idSchema, blockId: idSchema }).strict();

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "Use up to 20 letters, digits, '-' or '_'");
const version = z.number().int().positive();
const reason = z.string().trim().min(3, "A reason is required").max(1000);
const optionalReason = z.string().trim().min(3).max(1000).optional();

function requireReasonForOverride(
  value: { override: boolean; reason?: string },
  ctx: z.RefinementCtx,
) {
  if (value.override && !value.reason) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required to override" });
  }
}

export const groupsQuerySchema = cursorPageQuerySchema
  .extend({
    status: z.enum(GROUP_STATUSES).optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export type GroupsQuery = z.infer<typeof groupsQuerySchema>;

const groupFields = {
  name: z.string().trim().min(1).max(200),
  accountProfileId: idSchema.nullable().optional(),
  contactGuestId: idSchema.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
};

export const createGroupSchema = z.object({ code, ...groupFields }).strict();
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object(groupFields).strict();
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const groupStatusSchema = z
  .object({ status: z.enum(["CLOSED", "CANCELLED"]), reason })
  .strict();
export type GroupStatusInput = z.infer<typeof groupStatusSchema>;

export const createBlockSchema = z
  .object({
    code,
    name: z.string().trim().min(1).max(200),
    statusId: idSchema,
    /** First night and departure (exclusive). */
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    ratePlanId: idSchema,
    reservationTypeId: idSchema.optional(),
    marketCodeId: idSchema.optional(),
    sourceCodeId: idSchema.optional(),
    cutoffDate: isoDateSchema.nullable().optional(),
    isElastic: z.boolean().default(false),
    /** Rooms per night for each room type over the whole block. */
    allocations: z
      .array(z.object({ roomTypeId: idSchema, rooms: z.number().int().min(0).max(999) }).strict())
      .min(1)
      .max(20),
    override: z.boolean().default(false),
    reason: optionalReason,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireReasonForOverride(value, ctx);
    if (value.endDate <= value.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "Must be after the first night" });
    }
    const days =
      (Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) /
      86_400_000;
    if (days > 60) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "A block covers at most 60 nights",
      });
    }
    if (value.cutoffDate && value.cutoffDate > value.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["cutoffDate"],
        message: "Must be before the departure",
      });
    }
    const ids = value.allocations.map((a) => a.roomTypeId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["allocations"], message: "One row per room type" });
    }
  });
export type CreateBlockInput = z.infer<typeof createBlockSchema>;

/** Sets the rooms held per night for one room type over [from, to] (inclusive nights). */
export const allocationSchema = z
  .object({
    version,
    roomTypeId: idSchema,
    from: isoDateSchema,
    to: isoDateSchema,
    rooms: z.number().int().min(0).max(999),
    override: z.boolean().default(false),
    reason: optionalReason,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireReasonForOverride(value, ctx);
    if (value.to < value.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "Must be on or after the start" });
    }
  });
export type AllocationInput = z.infer<typeof allocationSchema>;

export const blockStatusSchema = z
  .object({
    version,
    statusId: idSchema,
    override: z.boolean().default(false),
    reason: optionalReason,
  })
  .strict()
  .superRefine(requireReasonForOverride);
export type BlockStatusInput = z.infer<typeof blockStatusSchema>;

/** Releases what the block still holds (all room types / the whole block by default). */
export const releaseSchema = z
  .object({
    version,
    roomTypeId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    reason,
  })
  .strict();
export type ReleaseInput = z.infer<typeof releaseSchema>;

/** A reservation picked up from the block; the rate, codes and type come from the block. */
export const pickupSchema = z
  .object({
    guestId: idSchema,
    roomTypeId: idSchema,
    arrival: isoDateSchema,
    departure: isoDateSchema,
    adults: z.number().int().min(1).max(12),
    children: z.number().int().min(0).max(12).default(0),
    rooms: z.number().int().min(1).max(9).default(1),
    eta: localTimeSchema.optional(),
    specialRequests: z.string().trim().max(2000).optional(),
    override: z.boolean().default(false),
    reason: optionalReason,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireReasonForOverride(value, ctx);
    if (value.departure <= value.arrival) {
      ctx.addIssue({ code: "custom", path: ["departure"], message: "Must be after arrival" });
    }
  });
export type PickupInput = z.infer<typeof pickupSchema>;
