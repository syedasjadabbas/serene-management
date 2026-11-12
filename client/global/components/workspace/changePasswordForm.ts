import { z } from "zod";
import { newPasswordSchema } from "@serene/shared/modules/identity/identity.schema";

/**
 * Current password, new password (shared length rule) and its repetition.
 * Field names equal the API body's, so server field errors map directly.
 */
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(256),
    newPassword: newPasswordSchema,
    confirm: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.confirm !== value.newPassword) {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "The passwords do not match" });
    }
  });

export const changePasswordDefaults = { currentPassword: "", newPassword: "", confirm: "" };

/** Form values to the API body (drops the repetition). */
export function toChangePasswordBody(values: { currentPassword: string; newPassword: string }) {
  return { currentPassword: values.currentPassword, newPassword: values.newPassword };
}
