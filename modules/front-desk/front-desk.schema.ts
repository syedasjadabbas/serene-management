import { z } from "zod";
import { cursorPageQuerySchema, idSchema, isoDateSchema } from "@/lib/validation/common";
import { createReservationSchema } from "@/modules/reservations/reservations.schema";
import { ARRIVAL_FILTERS, DEPARTURE_FILTERS, IN_HOUSE_FILTERS } from "./front-desk.policy";

export const stayParamsSchema = z.object({ propertyId: idSchema, stayId: idSchema }).strict();

const reasonText = z.string().trim().min(3).max(1000);
const listSearch = z.string().trim().min(2).max(100).optional();

/**
 * Check-in of a due-in reservation room. `roomId` assigns (or replaces) the
 * room in the same transaction. A room that is not clean / not inspected can
 * only be used with `acceptNotReady` and a reason (HIGH audit).
 */
export const checkInSchema = z
  .object({
    version: z.number().int().positive(),
    roomId: idSchema.optional(),
    acceptNotReady: z.boolean().default(false),
    reason: reasonText.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.acceptNotReady && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A reason is required to check in to a room that is not ready",
      });
    }
  });
export type CheckInInput = z.infer<typeof checkInSchema>;

/** In-house room move (same room type). `version` is the stay's version. */
export const roomMoveSchema = z
  .object({
    version: z.number().int().positive(),
    roomId: idSchema,
    reasonCodeId: idSchema,
    reason: reasonText.optional(),
    acceptNotReady: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.acceptNotReady && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A reason is required to move into a room that is not ready",
      });
    }
  });
export type RoomMoveInput = z.infer<typeof roomMoveSchema>;

/**
 * Check-out. Leaving before the booked departure must be confirmed
 * explicitly (`earlyDeparture`) with an EARLY_DEPARTURE reason code; the
 * unused nights are released in the same transaction.
 */
export const checkOutSchema = z
  .object({
    version: z.number().int().positive(),
    earlyDeparture: z.boolean().default(false),
    reasonCodeId: idSchema.optional(),
    reason: reasonText.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.earlyDeparture && !value.reasonCodeId) {
      ctx.addIssue({
        code: "custom",
        path: ["reasonCodeId"],
        message: "Choose an early departure reason",
      });
    }
  });
export type CheckOutInput = z.infer<typeof checkOutSchema>;

/**
 * In-house extension to a later departure. `version` is the stay's version;
 * `override` sells beyond availability (reservations:override_availability,
 * reason required).
 */
export const extendStaySchema = z
  .object({
    version: z.number().int().positive(),
    departure: isoDateSchema,
    override: z.boolean().default(false),
    reason: reasonText.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.override && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A reason is required to extend beyond availability",
      });
    }
  });
export type ExtendStayInput = z.infer<typeof extendStaySchema>;

/**
 * Walk-in: the regular booking contract, restricted to one room with a
 * specific room, arriving today (checked by the service against the
 * business date), followed by an immediate check-in.
 */
export const walkInSchema = createReservationSchema.superRefine((value, ctx) => {
  if (value.rooms !== 1) {
    ctx.addIssue({ code: "custom", path: ["rooms"], message: "A walk-in books one room" });
  }
  if (!value.roomId) {
    ctx.addIssue({ code: "custom", path: ["roomId"], message: "Choose the room for the guest" });
  }
  if (value.waitlist) {
    ctx.addIssue({ code: "custom", path: ["waitlist"], message: "A walk-in cannot be waitlisted" });
  }
});
export type WalkInInput = z.infer<typeof walkInSchema>;

export const arrivalsQuerySchema = cursorPageQuerySchema
  .extend({ q: listSearch, filter: z.enum(ARRIVAL_FILTERS).default("all") })
  .strict();
export type ArrivalsQuery = z.infer<typeof arrivalsQuerySchema>;

export const inHouseQuerySchema = cursorPageQuerySchema
  .extend({ q: listSearch, filter: z.enum(IN_HOUSE_FILTERS).default("all") })
  .strict();
export type InHouseQuery = z.infer<typeof inHouseQuerySchema>;

export const departuresQuerySchema = cursorPageQuerySchema
  .extend({ q: listSearch, filter: z.enum(DEPARTURE_FILTERS).default("all") })
  .strict();
export type DeparturesQuery = z.infer<typeof departuresQuerySchema>;
