import { z } from "zod";

/** Night-audit dialogs record one audited reason (3 to 1000 characters). */
export const nightAuditReasonSchema = z.object({
  reason: z
    .string()
    .refine((v) => v.trim().length >= 3, "Enter a reason of at least 3 characters")
    .refine((v) => v.length <= 1000, "Use at most 1000 characters"),
});

export const runDefaults = { reason: "End of day" };
export const recoverDefaults = { reason: "" };
