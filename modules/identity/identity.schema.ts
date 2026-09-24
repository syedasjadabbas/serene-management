import { z } from "zod";
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
