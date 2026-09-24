import { z } from "zod";
import { idSchema, isoDateSchema } from "@/lib/validation/common";
import { ROOM_BOARD_FILTERS } from "./rooms.policy";

export const roomParamsSchema = z.object({ propertyId: idSchema, roomId: idSchema }).strict();
export const blockParamsSchema = z.object({ propertyId: idSchema, blockId: idSchema }).strict();

export const roomBoardQuerySchema = z
  .object({
    filter: z.enum(ROOM_BOARD_FILTERS).default("all"),
    roomTypeId: idSchema.optional(),
    floorId: idSchema.optional(),
  })
  .strict();
export type RoomBoardQuery = z.infer<typeof roomBoardQuerySchema>;

const reason = z.string().trim().min(3).max(1000);

/**
 * Take a room out of order (removed from inventory) or out of service (kept
 * in inventory, not to be used) for [from, to). `from` defaults to the
 * business date. High-risk: a reason is required.
 */
export const placeBlockSchema = z
  .object({
    kind: z.enum(["OUT_OF_ORDER", "OUT_OF_SERVICE"]),
    from: isoDateSchema.optional(),
    to: isoDateSchema,
    reasonCodeId: idSchema,
    notes: z.string().trim().max(1000).optional(),
    reason,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from && value.to <= value.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "After the start date" });
    }
  });
export type PlaceBlockInput = z.infer<typeof placeBlockSchema>;

export const releaseBlockSchema = z.object({ reason }).strict();
export type ReleaseBlockInput = z.infer<typeof releaseBlockSchema>;
