import { z } from "zod";
import { idSchema, isoDateSchema } from "@/lib/validation/common";

export const guestParamsSchema = z.object({ guestId: idSchema }).strict();
export const guestNoteParamsSchema = z.object({ guestId: idSchema, noteId: idSchema }).strict();

/**
 * Guest search / list. With `q`: name words (any order), e-mail, phone
 * digits, profile number or a confirmation number of a reservation the user
 * can read. Without `q`: the organization's profiles by name. Keyset pages.
 */
export const guestSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2, "Type at least 2 characters").max(100).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    cursor: z.string().max(500).optional(),
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

/** Nullable text for updates: "" clears the field. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value : null));

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.email("Enter a valid email address").optional());

const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+0-9 ()-]*$/, "Digits, spaces, +, ( ) and - only")
  .optional()
  .transform((value) => (value ? value : undefined));

const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Two-letter country code");

export const CONTACT_TYPES = ["EMAIL", "PHONE", "MOBILE", "WHATSAPP", "FAX"] as const;
export const ADDRESS_TYPES = ["HOME", "BUSINESS", "BILLING", "OTHER"] as const;
export const NOTE_VISIBILITIES = ["ALL_STAFF", "MANAGEMENT", "INTERNAL"] as const;

export const createGuestSchema = z
  .object({
    title: optionalText(20),
    firstName: z.string().trim().min(1, "First name is required").max(100),
    lastName: z.string().trim().min(1, "Last name is required").max(100),
    preferredName: optionalText(100),
    email: emailSchema,
    phone: phoneSchema,
    nationalityCode: countrySchema.optional().or(z.literal("").transform(() => undefined)),
    languageCode: optionalText(10),
    /**
     * A profile with the same e-mail or phone already exists: the server
     * answers 409 POSSIBLE_DUPLICATE with the matches unless this is true.
     */
    allowDuplicate: z.boolean().default(false),
  })
  .strict();

export type CreateGuestInput = z.infer<typeof createGuestSchema>;

const contactSchema = z
  .object({
    type: z.enum(CONTACT_TYPES),
    value: z.string().trim().min(3).max(254),
    isPrimary: z.boolean().default(false),
    optIn: z.boolean().default(false),
  })
  .strict()
  .superRefine((contact, ctx) => {
    if (contact.type === "EMAIL" && !z.email().safeParse(contact.value).success) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a valid email address" });
    }
    if (contact.type !== "EMAIL" && !/^[+0-9 ()-]+$/.test(contact.value)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Digits, spaces, +, ( ) and - only",
      });
    }
  });

const addressSchema = z
  .object({
    type: z.enum(ADDRESS_TYPES),
    line1: z.string().trim().min(1).max(200),
    line2: nullableText(200),
    city: nullableText(100),
    region: nullableText(100),
    postalCode: nullableText(20),
    countryCode: countrySchema.nullable().optional(),
    isPrimary: z.boolean().default(false),
  })
  .strict();

/**
 * Full profile update (optimistic concurrency on `version`). Omitted fields
 * keep their value; `contacts` / `addresses`, when sent, replace the lists.
 * Date of birth and the restriction flag are sensitive (see the service).
 */
export const updateGuestSchema = z
  .object({
    version: z.number().int().positive(),
    title: nullableText(20),
    firstName: z.string().trim().min(1).max(100).optional(),
    middleName: nullableText(100),
    lastName: z.string().trim().min(1).max(100).optional(),
    preferredName: nullableText(100),
    gender: nullableText(20),
    dateOfBirth: isoDateSchema.nullable().optional(),
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
    preferredContact: z.enum(CONTACT_TYPES).nullable().optional(),
    nationalityCode: countrySchema.nullable().optional(),
    languageCode: nullableText(10),
    vipLevelId: idSchema.nullable().optional(),
    marketingOptIn: z.boolean().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    isRestricted: z.boolean().optional(),
    restrictionReason: nullableText(500),
    contacts: z.array(contactSchema).max(20).optional(),
    addresses: z.array(addressSchema).max(10).optional(),
    /** Audited reason; required for restriction and status changes. */
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();

export type UpdateGuestInput = z.infer<typeof updateGuestSchema>;

/** Replaces the guest's preferences at the given scopes (null = every property). */
export const guestPreferencesSchema = z
  .object({
    version: z.number().int().positive(),
    preferences: z
      .array(
        z
          .object({
            preferenceCodeId: idSchema,
            propertyId: idSchema.nullable(),
            note: nullableText(500),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type GuestPreferencesInput = z.infer<typeof guestPreferencesSchema>;

export const createGuestNoteSchema = z
  .object({
    body: z.string().trim().min(1, "Write the note").max(4000),
    visibility: z.enum(NOTE_VISIBILITIES).default("ALL_STAFF"),
    isAlert: z.boolean().default(false),
    /** Null = a note for every property. */
    propertyId: idSchema.nullable().default(null),
  })
  .strict();

export type CreateGuestNoteInput = z.infer<typeof createGuestNoteSchema>;

export const guestHistoryQuerySchema = z
  .object({
    propertyId: idSchema.optional(),
    status: z
      .enum(["RESERVED", "WAITLISTED", "IN_HOUSE", "CHECKED_OUT", "CANCELLED", "NO_SHOW"])
      .optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(500).optional(),
  })
  .strict();

export type GuestHistoryQuery = z.infer<typeof guestHistoryQuerySchema>;
