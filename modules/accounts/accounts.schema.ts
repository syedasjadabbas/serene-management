import { z } from "zod";
import { idSchema } from "@/lib/validation/common";

/**
 * Company / travel-agent profiles (AccountProfile, organization data) and
 * their guest relationships (AccountContact). Phase 7 manages COMPANY and
 * TRAVEL_AGENT accounts; other types are read-only here.
 */

export const ACCOUNT_TYPES = ["COMPANY", "TRAVEL_AGENT"] as const;
export const CONTACT_KINDS = ["EMPLOYEE", "CONTACT", "ASSOCIATE"] as const;

export const accountParamsSchema = z.object({ accountId: idSchema }).strict();
export const accountContactParamsSchema = z
  .object({ accountId: idSchema, guestId: idSchema })
  .strict();

export const accountsQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100).optional(),
    type: z.enum(ACCOUNT_TYPES).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(500).optional(),
  })
  .strict();
export type AccountsQuery = z.infer<typeof accountsQuerySchema>;

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "Use up to 20 letters, digits, '-' or '_'");

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value : null));

const accountFields = {
  name: z.string().trim().min(1, "Name is required").max(200),
  legalName: nullableText(200),
  iataNumber: nullableText(20),
  taxId: nullableText(60),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value : null))
    .pipe(z.email("Enter a valid email address").nullable().optional()),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+0-9 ()-]*$/, "Digits, spaces, +, ( ) and - only")
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value : null)),
  addressLine1: nullableText(200),
  addressLine2: nullableText(200),
  city: nullableText(100),
  region: nullableText(100),
  postalCode: nullableText(20),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Two-letter country code")
    .nullable()
    .optional(),
  notes: nullableText(4000),
};

export const createAccountSchema = z
  .object({ type: z.enum(ACCOUNT_TYPES).default("COMPANY"), code, ...accountFields })
  .strict();
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z
  .object({
    version: z.number().int().positive(),
    ...accountFields,
    name: accountFields.name.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    isRestricted: z.boolean().optional(),
    restrictionReason: nullableText(500),
    /** Audited reason; required for restriction and status changes. */
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

/** Creates or updates the relationship between the account and a guest. */
export const accountContactSchema = z
  .object({
    kind: z.enum(CONTACT_KINDS).default("CONTACT"),
    role: nullableText(100),
    isPrimary: z.boolean().default(false),
  })
  .strict();
export type AccountContactInput = z.infer<typeof accountContactSchema>;
