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
    /** Company the stay is for: also quotes its negotiated rate plans (Phase 7). */
    companyId: idSchema.optional(),
  })
  .strict()
  .superRefine(refineStay);

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

// --- Restriction management (Phase 6) ------------------------------------------------

export const RESTRICTION_TYPES = [
  "CLOSED",
  "CLOSED_TO_ARRIVAL",
  "CLOSED_TO_DEPARTURE",
  "MIN_LOS",
  "MAX_LOS",
  "MIN_STAY_THROUGH",
  "MAX_STAY_THROUGH",
  "MIN_ADVANCE_DAYS",
  "MAX_ADVANCE_DAYS",
] as const;

/** Types whose rule needs a number of nights / days. */
export const VALUED_RESTRICTIONS = new Set<string>([
  "MIN_LOS",
  "MAX_LOS",
  "MIN_STAY_THROUGH",
  "MAX_STAY_THROUGH",
  "MIN_ADVANCE_DAYS",
  "MAX_ADVANCE_DAYS",
]);

export const MAX_RESTRICTION_RANGE_DAYS = 366;

function rangeDays(from: string, to: string) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export const restrictionsQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    roomTypeId: idSchema.optional(),
    ratePlanId: idSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const days = rangeDays(value.from, value.to);
    if (!(days >= 0 && days < 93)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "Show between 1 and 93 days" });
    }
  });
export type RestrictionsQuery = z.infer<typeof restrictionsQuerySchema>;

/**
 * Sets or clears one restriction type over a date range (optionally only on
 * some weekdays) for one scope: house (no room type, no plan), a room type,
 * a rate plan, or both.
 */
export const setRestrictionsSchema = z
  .object({
    action: z.enum(["set", "clear"]),
    type: z.enum(RESTRICTION_TYPES),
    from: isoDateSchema,
    to: isoDateSchema,
    /** Mon=1 … Sun=64; 127 = every day. */
    daysOfWeek: z.number().int().min(1).max(127).default(127),
    roomTypeId: idSchema.nullable().default(null),
    ratePlanId: idSchema.nullable().default(null),
    value: z.number().int().min(0).max(365).nullable().default(null),
    reason: z.string().trim().min(3, "A reason is required").max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const days = rangeDays(value.from, value.to);
    if (!(days >= 0 && days < MAX_RESTRICTION_RANGE_DAYS)) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Choose between 1 and ${MAX_RESTRICTION_RANGE_DAYS} days`,
      });
    }
    const valued = VALUED_RESTRICTIONS.has(value.type);
    if (value.action === "set" && valued && (value.value === null || value.value < 1)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Enter a number of nights or days",
      });
    }
    if (value.action === "set" && !valued && value.value !== null) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "This restriction has no value" });
    }
  });
export type SetRestrictionsInput = z.infer<typeof setRestrictionsSchema>;
