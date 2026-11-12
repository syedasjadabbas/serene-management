import { z } from "zod";

/**
 * Sign-in form values. Same shape as the shared `loginSchema` (email trimmed
 * and lower-cased, password up to 256 characters) with the messages the form
 * has always shown.
 */
export const loginFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address").max(254, "Enter a valid email address")),
  password: z.string().min(1, "Enter your password").max(256, "Enter your password"),
});

export const loginFormDefaults = { email: "", password: "" };
