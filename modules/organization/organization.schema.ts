import { z } from "zod";
import { idSchema, isoDateSchema } from "@/lib/validation/common";
import { refineStay, stayFields } from "@/modules/availability/availability.schema";
import { daysBetween } from "@/modules/business-date/business-date.policy";
import { MAX_ROOMS_PER_BOOKING } from "@/modules/reservations/reservations.policy";
import { MAX_REPORT_DAYS } from "@/modules/reports/reports.policy";

/** Comma-separated property ids; always intersected with the caller's access. */
const propertyIdsSchema = z
  .string()
  .trim()
  .transform((value) =>
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  )
  .pipe(z.array(idSchema).max(50))
  .optional();

/** Organization performance report: inclusive business-date range (D38). */
export const organizationPerformanceQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    propertyIds: propertyIdsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "Must be on or after the start date" });
    } else if (daysBetween(value.from, value.to) + 1 > MAX_REPORT_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `A report covers at most ${MAX_REPORT_DAYS} days`,
      });
    }
  });

export type OrganizationPerformanceQuery = z.infer<typeof organizationPerformanceQuerySchema>;

/** Central availability (D8): search only, the booking is handed off to one property. */
export const centralAvailabilityQuerySchema = z
  .object({
    ...stayFields,
    rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_BOOKING).default(1),
    propertyIds: propertyIdsSchema,
  })
  .strict()
  .superRefine(refineStay);

export type CentralAvailabilityQuery = z.infer<typeof centralAvailabilityQuerySchema>;
