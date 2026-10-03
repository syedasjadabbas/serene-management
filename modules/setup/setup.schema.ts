import { z } from "zod";
import { highRiskReasonSchema, idSchema, isoDateSchema } from "@/lib/validation/common";

/**
 * Property setup (room inventory and taxes): the configuration a property
 * needs before go-live and maintains afterwards (docs/IMPLEMENTATION_ROADMAP.md
 * Phase 2 "configuration screens"). Every change needs `settings:manage`, a
 * high-risk permission, so each body carries the audited reason.
 */

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "Use up to 20 letters, digits, '-' or '_'");
const name = z.string().trim().min(1, "Enter a name").max(100);
const description = z.string().trim().max(2000).optional();
const occupancy = z.number().int().min(0).max(20);
const sortOrder = z.number().int().min(0).max(9999).optional();
const status = z.enum(["ACTIVE", "INACTIVE"]);
const version = z.number().int().positive();

export const setupParamsSchema = z.object({ propertyId: idSchema }).strict();
export const roomTypeParamsSchema = z
  .object({ propertyId: idSchema, roomTypeId: idSchema })
  .strict();
export const floorParamsSchema = z.object({ propertyId: idSchema, floorId: idSchema }).strict();
export const roomParamsSchema = z.object({ propertyId: idSchema, roomId: idSchema }).strict();
export const taxParamsSchema = z.object({ propertyId: idSchema, taxRuleId: idSchema }).strict();

// --- Room types -------------------------------------------------------------------------

const roomTypeFields = {
  name,
  description,
  maxOccupancy: occupancy.min(1, "At least one guest"),
  maxAdults: occupancy.min(1, "At least one adult"),
  maxChildren: occupancy,
  defaultOccupancy: occupancy.min(1, "At least one guest"),
  sortOrder,
};

function checkOccupancy(
  input: Partial<Record<"maxOccupancy" | "maxAdults" | "maxChildren" | "defaultOccupancy", number>>,
  ctx: z.RefinementCtx,
) {
  const { maxOccupancy, maxAdults, maxChildren, defaultOccupancy } = input;
  if (maxOccupancy === undefined) return;
  if (maxAdults !== undefined && maxAdults > maxOccupancy) {
    ctx.addIssue({
      code: "custom",
      path: ["maxAdults"],
      message: "More adults than the room holds",
    });
  }
  if (maxChildren !== undefined && maxChildren > maxOccupancy) {
    ctx.addIssue({
      code: "custom",
      path: ["maxChildren"],
      message: "More children than the room holds",
    });
  }
  if (defaultOccupancy !== undefined && defaultOccupancy > maxOccupancy) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultOccupancy"],
      message: "The usual occupancy cannot exceed the maximum",
    });
  }
}

export const createRoomTypeSchema = highRiskReasonSchema
  .extend({ code, ...roomTypeFields })
  .strict()
  .superRefine(checkOccupancy);
export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;

/** Every field is sent (the form edits the whole room type); the code never changes. */
export const updateRoomTypeSchema = highRiskReasonSchema
  .extend({ ...roomTypeFields, status })
  .strict()
  .superRefine(checkOccupancy);
export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;

// --- Floors -----------------------------------------------------------------------------

const floorFields = { name, level: z.number().int().min(-10).max(200), sortOrder };

export const createFloorSchema = highRiskReasonSchema.extend({ code, ...floorFields }).strict();
export type CreateFloorInput = z.infer<typeof createFloorSchema>;

export const updateFloorSchema = highRiskReasonSchema.extend({ ...floorFields, status }).strict();
export type UpdateFloorInput = z.infer<typeof updateFloorSchema>;

// --- Rooms ------------------------------------------------------------------------------

const roomNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, "Use up to 20 letters, digits or '-'");

const roomFields = {
  roomTypeId: idSchema,
  floorId: idSchema.nullable(),
  description: z.string().trim().max(500).optional(),
  isSmoking: z.boolean().default(false),
  isAccessible: z.boolean().default(false),
};

/** New rooms start in the chosen housekeeping state (go-live: usually inspected). */
const initialHousekeeping = z.enum(["DIRTY", "CLEAN", "INSPECTED"]).default("DIRTY");

/**
 * One request creates up to 200 rooms of one type and floor, e.g. numbers
 * "101"–"120" from the form's range helper. Numbers are unique per property.
 */
export const createRoomsSchema = highRiskReasonSchema
  .extend({
    numbers: z
      .array(roomNumber)
      .min(1, "Enter at least one room number")
      .max(200, "At most 200 rooms at a time"),
    housekeepingStatus: initialHousekeeping,
    ...roomFields,
  })
  .strict()
  .refine((input) => new Set(input.numbers).size === input.numbers.length, {
    path: ["numbers"],
    message: "A room number is listed twice",
  });
export type CreateRoomsInput = z.infer<typeof createRoomsSchema>;

export const updateRoomSchema = highRiskReasonSchema
  .extend({ number: roomNumber, ...roomFields, status, version })
  .strict();
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

// --- Taxes ------------------------------------------------------------------------------

const rate = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,4})?$/, "Enter a rate like 16 or 16.5");

const taxFields = {
  name,
  calculation: z.enum(["PERCENT", "FLAT_PER_UNIT"]),
  basis: z.enum(["NET", "COMPOUND"]).default("NET"),
  rate,
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.nullable().default(null),
  /** Revenue codes the tax is added to (room charge, restaurant …). */
  appliesTo: z.array(idSchema).max(100).default([]),
};

function checkTax(
  input: {
    calculation?: string;
    rate?: string;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (input.calculation === "PERCENT" && input.rate !== undefined && Number(input.rate) > 100) {
    ctx.addIssue({ code: "custom", path: ["rate"], message: "A percentage cannot exceed 100" });
  }
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "Ends before it starts" });
  }
}

export const createTaxSchema = highRiskReasonSchema
  .extend({ code, ...taxFields })
  .strict()
  .superRefine(checkTax);
export type CreateTaxInput = z.infer<typeof createTaxSchema>;

export const updateTaxSchema = highRiskReasonSchema
  .extend({ ...taxFields, status })
  .strict()
  .superRefine(checkTax);
export type UpdateTaxInput = z.infer<typeof updateTaxSchema>;
