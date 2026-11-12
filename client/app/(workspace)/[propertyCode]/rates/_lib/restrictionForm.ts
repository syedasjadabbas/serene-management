import { z } from "zod";
import {
  RESTRICTION_TYPES,
  VALUED_RESTRICTIONS,
} from "@serene/shared/modules/availability/availability.schema";

/** Set or clear restrictions over a date range (every weekday = 127). */
export const restrictionFormSchema = z
  .object({
    action: z.enum(["set", "clear"]),
    type: z.enum(RESTRICTION_TYPES),
    from: z.string(),
    to: z.string(),
    daysOfWeek: z.number(),
    roomTypeId: z.string(),
    ratePlanId: z.string(),
    value: z.string(),
    reason: z.string(),
  })
  .superRefine((v, ctx) => {
    const add = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (!v.from) add("from", "Select the first date");
    if (!v.to) add("to", "Select the last date");
    if (v.daysOfWeek === 0) add("daysOfWeek", "Select at least one weekday");
    if (v.reason.trim().length < 3) add("reason", "Enter a reason of at least 3 characters");
  });

export type RestrictionFormValues = z.input<typeof restrictionFormSchema>;

export function restrictionDefaults(start: string): RestrictionFormValues {
  return {
    action: "set",
    type: "CLOSED_TO_ARRIVAL",
    from: start,
    to: start,
    daysOfWeek: 127,
    roomTypeId: "",
    ratePlanId: "",
    value: "2",
    reason: "",
  };
}

export function isValuedRestriction(type: RestrictionFormValues["type"]) {
  return VALUED_RESTRICTIONS.has(type);
}

export function restrictionPayload(v: RestrictionFormValues) {
  return {
    action: v.action,
    type: v.type,
    from: v.from,
    to: v.to,
    daysOfWeek: v.daysOfWeek,
    roomTypeId: v.roomTypeId || null,
    ratePlanId: v.ratePlanId || null,
    value: v.action === "set" && isValuedRestriction(v.type) ? Number.parseInt(v.value, 10) : null,
    reason: v.reason.trim(),
  };
}
