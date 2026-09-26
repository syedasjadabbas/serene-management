import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { idSchema } from "@/lib/validation/common";

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    // No complexity rules on login: only bound the size (argon2 input).
    password: z.string().min(1).max(256),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const sessionParamsSchema = z.object({ sessionId: idSchema }).strict();

/** A new password: length only (NIST SP 800-63B); never trimmed. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: newPasswordSchema,
  })
  .strict();

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** One-time reset token (256-bit, base64url) plus the new password. */
export const completePasswordResetSchema = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{32,128}$/, "Invalid reset link"),
    newPassword: newPasswordSchema,
  })
  .strict();

export type CompletePasswordResetInput = z.infer<typeof completePasswordResetSchema>;
