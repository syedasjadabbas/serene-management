import { z } from "zod";
import { newPasswordSchema } from "@serene/shared/modules/identity/identity.schema";

/** New password plus its repetition; the repeat must match. */
export const resetPasswordFormSchema = z
  .object({ newPassword: newPasswordSchema, confirm: z.string() })
  .superRefine((value, ctx) => {
    if (value.confirm !== value.newPassword) {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "The passwords do not match" });
    }
  });

export const resetPasswordDefaults = { newPassword: "", confirm: "" };
