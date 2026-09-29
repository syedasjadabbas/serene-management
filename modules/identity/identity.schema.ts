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

/** Self-service profile (the signed-in user edits their own display name). */
export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "Enter your name")
      .max(120, "At most 120 characters")
      .regex(/^[^\p{Cc}\p{Cf}]+$/u, "Remove special or invisible characters"),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Profile picture types; the server also checks the file signature. */
export const AVATAR_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];
/** 256 KB decoded; the browser sends a 256 px image well below this. */
export const AVATAR_MAX_BYTES = 262_144;

/** JSON-only upload (API_CONVENTIONS): the image travels as base64. */
export const uploadAvatarSchema = z
  .object({
    contentType: z.enum(AVATAR_CONTENT_TYPES),
    data: z
      .string()
      .min(8)
      .max(Math.ceil(AVATAR_MAX_BYTES / 3) * 4, "The image is too large (max 256 KB)")
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Invalid image data"),
  })
  .strict();

export type UploadAvatarInput = z.infer<typeof uploadAvatarSchema>;
