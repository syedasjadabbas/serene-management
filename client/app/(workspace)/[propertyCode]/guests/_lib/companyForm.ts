import { z } from "zod";

/** "" or a valid e-mail address (same rule and message as the shared account contract). */
const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === "" || z.email().safeParse(value).success, {
    message: "Enter a valid email address",
  });

const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+0-9 ()-]*$/, "Digits, spaces, +, ( ) and - only");

/**
 * New company dialog. Output is the `createAccount` request body: the code is
 * trimmed and upper-cased, empty optional fields become null.
 */
export const newCompanyFormSchema = z
  .object({
    type: z.enum(["COMPANY", "TRAVEL_AGENT"]),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "Use up to 20 letters, digits, '-' or '_'"),
    name: z.string().trim().min(1, "Name is required").max(200),
    email: optionalEmail,
    phone: optionalPhone,
    city: z.string().max(100),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^([A-Z]{2})?$/, "Two-letter country code"),
    notes: z.string().max(4000),
  })
  .transform((value) => ({
    type: value.type,
    code: value.code,
    name: value.name,
    email: value.email || null,
    phone: value.phone || null,
    city: value.city || null,
    countryCode: value.countryCode || null,
    notes: value.notes || null,
  }));

export const newCompanyDefaults = {
  type: "COMPANY" as "COMPANY" | "TRAVEL_AGENT",
  code: "",
  name: "",
  email: "",
  phone: "",
  city: "",
  countryCode: "",
  notes: "",
};
