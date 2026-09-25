import { z } from "zod";
import { idSchema, isoDateSchema } from "@/lib/validation/common";

/**
 * Rate administration contracts (Phase 6). Prices travel as decimal strings
 * and are checked against the property currency's minor units by the
 * service; currency itself is never accepted from the client (a rate plan
 * is always in the property currency).
 */

export const ratePlanParamsSchema = z
  .object({ propertyId: idSchema, ratePlanId: idSchema })
  .strict();
export const seasonParamsSchema = z
  .object({ propertyId: idSchema, ratePlanId: idSchema, seasonId: idSchema })
  .strict();
export const packageParamsSchema = z.object({ propertyId: idSchema, packageId: idSchema }).strict();

export const RATE_PLAN_KINDS = [
  "BAR",
  "RACK",
  "CORPORATE",
  "NEGOTIATED",
  "GROUP",
  "PACKAGE",
  "PROMOTIONAL",
  "MEMBER",
  "GOVERNMENT",
  "WHOLESALE",
  "COMPLIMENTARY",
  "HOUSE_USE",
] as const;

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "Use up to 20 letters, digits, '-' or '_'");
const name = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(3, "A reason is required").max(1000);
const version = z.number().int().positive();

/** A price: non-negative decimal, precision checked against the currency. */
export const priceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,4})?$/, "Enter an amount like 18500.00");
/** A derivation value: signed percent or amount. */
const derivationValue = z
  .string()
  .trim()
  .regex(/^-?\d{1,13}(\.\d{1,4})?$/, "Enter a number like -10 or 2500.00");

const derivation = z
  .object({
    parentRatePlanId: idSchema,
    type: z.enum(["PERCENT", "AMOUNT"]),
    value: derivationValue,
    roundingIncrement: priceSchema.nullable().optional(),
  })
  .strict();

const ratePlanFields = {
  name,
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z.enum(RATE_PLAN_KINDS),
  categoryId: idSchema.nullable().optional(),
  taxInclusive: z.boolean(),
  roomTransactionCodeId: idSchema,
  derivation: derivation.nullable(),
  sellFrom: isoDateSchema.nullable().optional(),
  sellTo: isoDateSchema.nullable().optional(),
  stayFrom: isoDateSchema.nullable().optional(),
  stayTo: isoDateSchema.nullable().optional(),
  cancellationPolicyId: idSchema.nullable().optional(),
  depositPolicyId: idSchema.nullable().optional(),
  defaultMarketCodeId: idSchema.nullable().optional(),
  defaultSourceCodeId: idSchema.nullable().optional(),
  displayOrder: z.number().int().min(0).max(9999).default(0),
  roomTypeIds: z.array(idSchema).min(1, "Select at least one room type").max(50),
  /** Sold only to companies linked to the plan (negotiated rates, Phase 7). */
  requiresNegotiation: z.boolean().default(false),
};

/** Window order, and negotiated plans are never public (Phase 7). */
function refinePlan(
  value: Parameters<typeof refineWindows>[0] & { kind: string; requiresNegotiation: boolean },
  ctx: z.RefinementCtx,
) {
  refineWindows(value, ctx);
  if (value.kind === "NEGOTIATED" && !value.requiresNegotiation) {
    ctx.addIssue({
      code: "custom",
      path: ["requiresNegotiation"],
      message: "A negotiated plan is sold only to its companies",
    });
  }
}

function refineWindows(
  value: {
    sellFrom?: string | null;
    sellTo?: string | null;
    stayFrom?: string | null;
    stayTo?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (value.sellFrom && value.sellTo && value.sellTo < value.sellFrom) {
    ctx.addIssue({ code: "custom", path: ["sellTo"], message: "Must be on or after the start" });
  }
  if (value.stayFrom && value.stayTo && value.stayTo < value.stayFrom) {
    ctx.addIssue({ code: "custom", path: ["stayTo"], message: "Must be on or after the start" });
  }
}

export const createRatePlanSchema = z
  .object({ code, ...ratePlanFields, reason })
  .strict()
  .superRefine(refinePlan);
export type CreateRatePlanInput = z.infer<typeof createRatePlanSchema>;

export const updateRatePlanSchema = z
  .object({
    version,
    ...ratePlanFields,
    status: z.enum(["ACTIVE", "INACTIVE"]),
    reason,
  })
  .strict()
  .superRefine(refinePlan);
export type UpdateRatePlanInput = z.infer<typeof updateRatePlanSchema>;

const seasonAmount = z
  .object({
    roomTypeId: idSchema,
    oneAdult: priceSchema,
    twoAdults: priceSchema.nullable().optional(),
    threeAdults: priceSchema.nullable().optional(),
    fourAdults: priceSchema.nullable().optional(),
    extraAdult: priceSchema.nullable().optional(),
    extraChild: priceSchema.nullable().optional(),
  })
  .strict();

export const seasonSchema = z
  .object({
    version,
    name,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    /** Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64. */
    daysOfWeek: z.number().int().min(1).max(127),
    priority: z.number().int().min(0).max(1000),
    amounts: z.array(seasonAmount).min(1).max(50),
    reason,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "Must be on or after the start" });
    }
    const ids = value.amounts.map((a) => a.roomTypeId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["amounts"], message: "One price row per room type" });
    }
  });
export type SeasonInput = z.infer<typeof seasonSchema>;

export const deleteSeasonSchema = z.object({ version, reason }).strict();

export const ratePlanPackagesSchema = z
  .object({ version, packageIds: z.array(idSchema).max(20), reason })
  .strict();
export type RatePlanPackagesInput = z.infer<typeof ratePlanPackagesSchema>;

/** Companies a negotiated plan is sold to, with optional stay windows (Phase 7). */
export const ratePlanAccountsSchema = z
  .object({
    version,
    accounts: z
      .array(
        z
          .object({
            accountProfileId: idSchema,
            validFrom: isoDateSchema.nullable().default(null),
            validTo: isoDateSchema.nullable().default(null),
          })
          .strict()
          .refine((a) => !a.validFrom || !a.validTo || a.validFrom <= a.validTo, {
            message: "The window ends before it starts",
            path: ["validTo"],
          }),
      )
      .max(100),
    reason,
  })
  .strict();
export type RatePlanAccountsInput = z.infer<typeof ratePlanAccountsSchema>;

export const MAX_CALENDAR_DAYS = 62;

export const calendarQuerySchema = z
  .object({
    ratePlanId: idSchema,
    roomTypeId: idSchema,
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const days =
      (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000;
    if (!(days >= 0 && days < MAX_CALENDAR_DAYS)) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Show between 1 and ${MAX_CALENDAR_DAYS} days`,
      });
    }
  });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

// --- Packages ---------------------------------------------------------------------------

export const PACKAGE_POSTING_TYPES = [
  "INCLUDED_IN_RATE",
  "SEPARATE_LINE",
  "COMBINED_WITH_ROOM",
] as const;
export const PACKAGE_CALCULATIONS = ["PER_ROOM", "PER_PERSON", "PER_ADULT", "PER_CHILD"] as const;
export const PACKAGE_RHYTHMS = [
  "EVERY_NIGHT",
  "ARRIVAL_NIGHT",
  "LAST_NIGHT",
  "EVERY_NIGHT_EXCEPT_ARRIVAL",
  "EVERY_NIGHT_EXCEPT_LAST",
  "WEEKDAYS",
  "ONCE_PER_STAY",
] as const;

const componentSchema = z
  .object({
    /** Existing component to update; omitted for a new one. */
    id: idSchema.optional(),
    name,
    transactionCodeId: idSchema,
    calculation: z.enum(PACKAGE_CALCULATIONS),
    rhythm: z.enum(PACKAGE_RHYTHMS),
    daysOfWeek: z.number().int().min(1).max(127).default(127),
    unitPrice: priceSchema,
  })
  .strict();

const packageFields = {
  name,
  description: z.string().trim().max(2000).nullable().optional(),
  postingType: z.enum(PACKAGE_POSTING_TYPES),
  sellSeparately: z.boolean().default(false),
  components: z.array(componentSchema).min(1).max(10),
};

export const createPackageSchema = z.object({ code, ...packageFields }).strict();
export type CreatePackageInput = z.infer<typeof createPackageSchema>;

export const updatePackageSchema = z
  .object({ ...packageFields, status: z.enum(["ACTIVE", "INACTIVE"]) })
  .strict();
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;

/** Books a package on a reservation room for future stay nights. */
export const reservationPackageSchema = z
  .object({
    packageId: idSchema,
    quantity: z.number().int().min(1).max(20).default(1),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .strict();
export type ReservationPackageInput = z.infer<typeof reservationPackageSchema>;
