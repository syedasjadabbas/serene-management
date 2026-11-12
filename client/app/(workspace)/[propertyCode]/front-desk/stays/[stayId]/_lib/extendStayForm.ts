import { z } from "zod";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";

/**
 * Extend-stay form: the new departure must be after the current one and an
 * availability override needs a reason of at least 3 characters.
 */
export function extendStayFormSchema(currentDeparture: string) {
  return z
    .object({
      departure: z.string(),
      override: z.boolean(),
      reason: z.string(),
    })
    .superRefine((value, ctx) => {
      if (value.departure <= currentDeparture) {
        ctx.addIssue({
          code: "custom",
          path: ["departure"],
          message: "The new departure must be after the current one",
        });
      }
      if (value.override && value.reason.trim().length < 3) {
        ctx.addIssue({
          code: "custom",
          path: ["reason"],
          message: "Enter a reason of at least 3 characters",
        });
      }
    });
}

export function extendStayDefaults(currentDeparture: string) {
  return { departure: addDays(currentDeparture, 1), override: false, reason: "" };
}
