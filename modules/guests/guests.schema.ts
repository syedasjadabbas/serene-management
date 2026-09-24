import { z } from "zod";
import { idSchema } from "@/lib/validation/common";

export const guestParamsSchema = z.object({ guestId: idSchema }).strict();

export const guestSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2, "Type at least 2 characters").max(100),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .strict();

export type GuestSearchQuery = z.infer<typeof guestSearchQuerySchema>;

/** Empty strings from forms become undefined. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const createGuestSchema = z
  .object({
    title: optionalText(20),
    firstName: z.string().trim().min(1, "First name is required").max(100),
    lastName: z.string().trim().min(1, "Last name is required").max(100),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .optional()
      .transform((value) => (value ? value : undefined))
      .pipe(z.email("Enter a valid email address").optional()),
    phone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[+0-9 ()-]*$/, "Digits, spaces, +, ( ) and - only")
      .optional()
      .transform((value) => (value ? value : undefined)),
    nationalityCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Two-letter country code")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    languageCode: optionalText(10),
  })
  .strict();

export type CreateGuestInput = z.infer<typeof createGuestSchema>;
