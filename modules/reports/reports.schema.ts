import { z } from "zod";
import { idSchema, isoDateSchema } from "@/lib/validation/common";
import { daysBetween } from "@/modules/business-date/business-date.policy";
import { MAX_REPORT_DAYS } from "./reports.policy";

export const REPORT_KEYS = [
  "manager-flash",
  "occupancy",
  "room-type-performance",
  "arrivals",
  "departures",
  "in-house",
  "no-shows",
  "cancellations",
  "room-status",
  "housekeeping",
  "revenue-by-code",
  "tax",
  "payments",
  "voids-refunds",
  "adjustments",
  "guest-ledger",
  "ledger-roll-forward",
  "rate-plan-production",
  "package-revenue",
  "company-production",
  "group-production",
  "night-audit-history",
  "audit-trail",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const reportsParamsSchema = z.object({ propertyId: idSchema }).strict();

export const reportParamsSchema = z
  .object({ propertyId: idSchema, reportKey: z.enum(REPORT_KEYS) })
  .strict();

/** Inclusive business-date range (defaults to the current business date). */
export const reportQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    roomTypeId: idSchema.optional(),
    risk: z.enum(["LOW", "STANDARD", "HIGH"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from && value.to) {
      if (value.to < value.from) {
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "Must be on or after the start date",
        });
      } else if (daysBetween(value.from, value.to) + 1 > MAX_REPORT_DAYS) {
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: `A report covers at most ${MAX_REPORT_DAYS} days`,
        });
      }
    }
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const dashboardParamsSchema = reportsParamsSchema;
