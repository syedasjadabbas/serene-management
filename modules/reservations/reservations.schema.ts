import { z } from "zod";
import { refineStay, stayFields } from "@/modules/availability/availability.schema";
import { daysBetween, isDateOnly } from "@/modules/business-date/business-date.policy";
import {
  cursorPageQuerySchema,
  idSchema,
  isoDateSchema,
  localTimeSchema,
} from "@/lib/validation/common";
import { MAX_ROOMS_PER_BOOKING, MAX_STAY_NIGHTS } from "./reservations.policy";

export const reservationParamsSchema = z
  .object({ propertyId: idSchema, reservationId: idSchema })
  .strict();
export const reservationRoomParamsSchema = z
  .object({ propertyId: idSchema, reservationRoomId: idSchema })
  .strict();

/**
 * Override of availability / restrictions. Requires
 * reservations:override_availability and a written reason (HIGH audit).
 */
const overrideFields = {
  override: z.boolean().default(false),
  reason: z.string().trim().min(3).max(1000).optional(),
};

function requireReasonForOverride(
  value: { override: boolean; reason?: string },
  ctx: z.RefinementCtx,
) {
  if (value.override && !value.reason) {
    ctx.addIssue({
      code: "custom",
      path: ["reason"],
      message: "A reason is required to override availability",
    });
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const createReservationSchema = z
  .object({
    arrival: stayFields.arrival,
    departure: stayFields.departure,
    adults: z.number().int().min(1).max(12),
    children: z.number().int().min(0).max(12).default(0),
    rooms: z.number().int().min(1).max(MAX_ROOMS_PER_BOOKING).default(1),
    roomTypeId: idSchema,
    ratePlanId: idSchema,
    reservationTypeId: idSchema,
    guestId: idSchema,
    /** Specific room (single-room bookings only). */
    roomId: idSchema.optional(),
    marketCodeId: idSchema.optional(),
    sourceCodeId: idSchema.optional(),
    channelId: idSchema.optional(),
    eta: localTimeSchema.optional().or(z.literal("").transform(() => undefined)),
    specialRequests: optionalText(2000),
    externalReference: optionalText(60),
    /** Book onto the waitlist instead of deducting inventory. */
    waitlist: z.boolean().default(false),
    ...overrideFields,
  })
  .strict()
  .superRefine((value, ctx) => {
    refineStay(value, ctx);
    requireReasonForOverride(value, ctx);
    if (value.roomId && value.rooms > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["roomId"],
        message: "A specific room can only be chosen for a single room",
      });
    }
    if (value.waitlist && value.roomId) {
      ctx.addIssue({
        code: "custom",
        path: ["roomId"],
        message: "Waitlisted reservations cannot hold a room",
      });
    }
  });

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const updateReservationRoomSchema = z
  .object({
    version: z.number().int().positive(),
    arrival: isoDateSchema.optional(),
    departure: isoDateSchema.optional(),
    adults: z.number().int().min(1).max(12).optional(),
    children: z.number().int().min(0).max(12).optional(),
    roomTypeId: idSchema.optional(),
    ratePlanId: idSchema.optional(),
    primaryGuestId: idSchema.optional(),
    marketCodeId: idSchema.optional(),
    sourceCodeId: idSchema.optional(),
    eta: localTimeSchema.nullable().optional(),
    ...overrideFields,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireReasonForOverride(value, ctx);
    const changes = Object.keys(value).filter(
      (k) => !["version", "override", "reason"].includes(k),
    );
    if (changes.length === 0)
      ctx.addIssue({ code: "custom", message: "Provide at least one change" });
    if (
      value.arrival &&
      value.departure &&
      isDateOnly(value.arrival) &&
      isDateOnly(value.departure)
    ) {
      const nights = daysBetween(value.arrival, value.departure);
      if (nights < 1)
        ctx.addIssue({
          code: "custom",
          path: ["departure"],
          message: "Departure must be after arrival",
        });
      if (nights > MAX_STAY_NIGHTS) {
        ctx.addIssue({
          code: "custom",
          path: ["departure"],
          message: `A stay may not exceed ${MAX_STAY_NIGHTS} nights`,
        });
      }
    }
  });

export type UpdateReservationRoomInput = z.infer<typeof updateReservationRoomSchema>;

export const confirmReservationSchema = z
  .object({
    version: z.number().int().positive(),
    /** A reservation type that deducts inventory (guaranteed / confirmed). */
    reservationTypeId: idSchema,
    ...overrideFields,
  })
  .strict()
  .superRefine(requireReasonForOverride);

export type ConfirmReservationInput = z.infer<typeof confirmReservationSchema>;

/** Cancellation and no-show are high-risk: reason code plus written reason. */
export const cancelReservationSchema = z
  .object({
    version: z.number().int().positive(),
    reasonCodeId: idSchema,
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

export const noShowReservationSchema = cancelReservationSchema;
export type NoShowReservationInput = CancelReservationInput;

export const reinstateReservationSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000),
    override: z.boolean().default(false),
  })
  .strict();

export type ReinstateReservationInput = z.infer<typeof reinstateReservationSchema>;

export const assignRoomSchema = z
  .object({ version: z.number().int().positive(), roomId: idSchema.nullable() })
  .strict();

export type AssignRoomInput = z.infer<typeof assignRoomSchema>;

export const BOOKING_STATES = [
  "WAITLISTED",
  "TENTATIVE",
  "CONFIRMED",
  "IN_HOUSE",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
] as const;

/** "?state=CONFIRMED,TENTATIVE" → ["CONFIRMED", "TENTATIVE"]. */
const bookingStatesCsv = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : undefined,
  )
  .pipe(z.array(z.enum(BOOKING_STATES)).max(10).optional());

export const RESERVATION_SORTS = ["arrival", "-arrival", "-created"] as const;

export const listReservationsQuerySchema = cursorPageQuerySchema
  .extend({
    q: z.string().trim().min(2).max(100).optional(),
    state: bookingStatesCsv,
    arrivalFrom: isoDateSchema.optional(),
    arrivalTo: isoDateSchema.optional(),
    departureFrom: isoDateSchema.optional(),
    departureTo: isoDateSchema.optional(),
    createdFrom: isoDateSchema.optional(),
    createdTo: isoDateSchema.optional(),
    roomTypeId: idSchema.optional(),
    sourceCodeId: idSchema.optional(),
    channelId: idSchema.optional(),
    guestId: idSchema.optional(),
    sort: z.enum(RESERVATION_SORTS).default("arrival"),
  })
  .strict();

export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;

export const availableRoomsQuerySchema = z
  .object({
    roomTypeId: idSchema,
    arrival: isoDateSchema,
    departure: isoDateSchema,
    excludeReservationRoomId: idSchema.optional(),
  })
  .strict()
  .superRefine(refineStay);

export type AvailableRoomsQuery = z.infer<typeof availableRoomsQuerySchema>;
