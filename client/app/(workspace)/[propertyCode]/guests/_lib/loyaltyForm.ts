import { z } from "zod";

const reasonSchema = z
  .string()
  .trim()
  .min(3, "Enter a reason of at least 3 characters")
  .max(500, "At most 500 characters");

/** New loyalty program. Output is the create request body. */
export const programFormSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(20),
  name: z.string().trim().min(1, "Name is required").max(100),
  isExternal: z.boolean(),
  reason: reasonSchema,
});
export const programFormDefaults = { code: "", name: "", isExternal: false, reason: "" };

/** Activate / deactivate a program: only the audited reason. */
export const programStatusFormSchema = z.object({ reason: reasonSchema });

/** Digits-only number field: "" is null. */
const optionalCount = z
  .string()
  .transform((value) => (value === "" ? null : Number.parseInt(value, 10)));

/**
 * Tier create / edit. The code is required only when creating; the status
 * only matters when editing. Output holds the numbers the API takes.
 */
export function tierFormSchema(isEdit: boolean) {
  return z
    .object({
      code: z.string().trim().max(20),
      name: z.string().trim().min(1, "Name is required").max(100),
      rank: z.string().transform((value) => Number.parseInt(value || "0", 10)),
      qualifyingNights: optionalCount,
      qualifyingStays: optionalCount,
      status: z.enum(["ACTIVE", "INACTIVE"]),
      reason: reasonSchema,
    })
    .superRefine((value, ctx) => {
      if (!isEdit && !value.code) {
        ctx.addIssue({ code: "custom", path: ["code"], message: "Code is required" });
      }
    });
}

export function tierFormDefaults(
  tier: {
    code: string;
    name: string;
    rank: number;
    qualifyingNights: number | null;
    qualifyingStays: number | null;
    status: "ACTIVE" | "INACTIVE";
  } | null,
  tierCount: number,
) {
  return {
    code: tier?.code ?? "",
    name: tier?.name ?? "",
    rank: String(tier?.rank ?? tierCount + 1),
    qualifyingNights: tier?.qualifyingNights?.toString() ?? "",
    qualifyingStays: tier?.qualifyingStays?.toString() ?? "",
    status: tier?.status ?? ("ACTIVE" as "ACTIVE" | "INACTIVE"),
    reason: "",
  };
}
