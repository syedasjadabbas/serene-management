import { z } from "zod";
import { isValidTimeZone } from "@/modules/business-date/business-date.policy";
import { highRiskReasonSchema, idSchema, localTimeSchema } from "@/lib/validation/common";

/** First path segments owned by the application; a property code may not shadow them. */
export const RESERVED_PROPERTY_CODES = [
  "API",
  "LOGIN",
  "LOGOUT",
  "REFRESH",
  "ORGANIZATION",
  "ADMIN",
  "NO-ACCESS",
];

export const propertyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "2–10 letters or digits, starting with a letter")
  .refine((code) => !RESERVED_PROPERTY_CODES.includes(code), "This code is reserved");

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, "Unknown IANA time zone");

export const propertyParamsSchema = z.object({ propertyId: idSchema }).strict();

export const createPropertySchema = highRiskReasonSchema
  .extend({
    code: propertyCodeSchema,
    name: z.string().trim().min(2).max(200),
    legalName: z.string().trim().max(200).optional(),
    timezone: timeZoneSchema,
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    checkInTime: localTimeSchema.default("14:00"),
    checkOutTime: localTimeSchema.default("12:00"),
    addressLine1: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.email().max(254).optional(),
  })
  .strict();

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const updatePropertyConfigurationSchema = highRiskReasonSchema
  .extend({
    timezone: timeZoneSchema.optional(),
    checkInTime: localTimeSchema.optional(),
    checkOutTime: localTimeSchema.optional(),
    maxFolioWindows: z.number().int().min(1).max(99).optional(),
    allowOverbooking: z.boolean().optional(),
    requireInspectedForCheckIn: z.boolean().optional(),
    usePickupStatus: z.boolean().optional(),
    useInspectedStatus: z.boolean().optional(),
    autoNoShowOnNightAudit: z.boolean().optional(),
    postNoShowCharges: z.boolean().optional(),
    requireZeroBalanceCheckout: z.boolean().optional(),
    allowCancelWithDeposit: z.boolean().optional(),
    autoCloseCashiersOnAudit: z.boolean().optional(),
    roomHoldDefaultMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .strict()
  .refine(
    (input) => Object.keys(input).some((key) => key !== "reason" && key !== "reasonCodeId"),
    "Provide at least one setting to change",
  );

export type UpdatePropertyConfigurationInput = z.infer<typeof updatePropertyConfigurationSchema>;
