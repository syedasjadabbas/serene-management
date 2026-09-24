import { z } from "zod";
import { MAX_ROOMS_PER_BOOKING, MAX_STAY_NIGHTS } from "@/modules/reservations/reservations.policy";
import { daysBetween, isDateOnly } from "@/modules/business-date/business-date.policy";
import { idSchema, isoDateSchema } from "@/lib/validation/common";

/** Shared stay shape: arrival inclusive, departure exclusive, at least one night. */
export const stayFields = {
  arrival: isoDateSchema,
  departure: isoDateSchema,
  adults: z.coerce.number().int().min(1, "At least one adult").max(12),
  children: z.coerce.number().int().min(0).max(12).default(0),
};

export function refineStay<T extends { arrival: string; departure: string }>(
  stay: T,
  ctx: z.RefinementCtx,
) {
  // Field-level date errors are already reported; only compare two valid dates.
  if (!isDateOnly(stay.arrival) || !isDateOnly(stay.departure)) return;
  const nights = daysBetween(stay.arrival, stay.departure);
  if (nights < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["departure"],
      message: "Departure must be after arrival",
    });
  } else if (nights > MAX_STAY_NIGHTS) {
    ctx.addIssue({
      code: "custom",
      path: ["departure"],
      message: `A stay may not exceed ${MAX_STAY_NIGHTS} nights`,
    });
  }
}

export const availabilityQuerySchema = z
  .object({
    ...stayFields,
    rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_BOOKING).default(1),
    roomTypeId: idSchema.optional(),
    ratePlanId: idSchema.optional(),
  })
  .strict()
  .superRefine(refineStay);

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
