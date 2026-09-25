import { z } from "zod";
import { idSchema } from "@/lib/validation/common";

/**
 * Loyalty foundation (Phase 7): programs, tiers, enrollment, tier/status
 * changes and manual point adjustments. loyalty:manage is high-risk, so
 * every command carries an audited reason. Automatic earning waits for a
 * reliable stay event (night audit / check-out posting, Phase 8+).
 */

export const programParamsSchema = z.object({ programId: idSchema }).strict();
export const tierParamsSchema = z.object({ tierId: idSchema }).strict();
export const membershipParamsSchema = z.object({ membershipId: idSchema }).strict();

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "Use up to 20 letters, digits, '-' or '_'");
const reason = z.string().trim().min(3, "A reason is required").max(500);
const threshold = z.number().int().min(0).max(100000).nullable().optional();

export const createProgramSchema = z
  .object({
    code,
    name: z.string().trim().min(1).max(100),
    isExternal: z.boolean().default(false),
    reason,
  })
  .strict();
export type CreateProgramInput = z.infer<typeof createProgramSchema>;

export const updateProgramSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    reason,
  })
  .strict();
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;

export const createTierSchema = z
  .object({
    code,
    name: z.string().trim().min(1).max(100),
    rank: z.number().int().min(0).max(100),
    qualifyingNights: threshold,
    qualifyingStays: threshold,
    reason,
  })
  .strict();
export type CreateTierInput = z.infer<typeof createTierSchema>;

export const updateTierSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    rank: z.number().int().min(0).max(100).optional(),
    qualifyingNights: threshold,
    qualifyingStays: threshold,
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    reason,
  })
  .strict();
export type UpdateTierInput = z.infer<typeof updateTierSchema>;

export const enrollSchema = z
  .object({
    programId: idSchema,
    tierId: idSchema.nullable().optional(),
    /** Required for external programs (their number); generated otherwise. */
    membershipNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,40}$/, "3–40 letters, digits or '-'")
      .optional(),
    reason,
  })
  .strict();
export type EnrollInput = z.infer<typeof enrollSchema>;

export const changeMembershipSchema = z
  .object({
    version: z.number().int().positive(),
    tierId: idSchema.nullable().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    reason,
  })
  .strict()
  .refine((v) => v.tierId !== undefined || v.status !== undefined, {
    message: "Change the tier or the status",
    path: ["tierId"],
  });
export type ChangeMembershipInput = z.infer<typeof changeMembershipSchema>;

/**
 * Manual correction of the points balance (whole points, signed). The
 * membership version makes a retried request a 409 instead of a second
 * adjustment.
 */
export const pointsAdjustmentSchema = z
  .object({
    version: z.number().int().positive(),
    points: z
      .string()
      .trim()
      .regex(/^-?[1-9]\d{0,8}$/, "Whole points, e.g. 500 or -200"),
    description: z.string().trim().min(3).max(200),
    reason,
  })
  .strict();
export type PointsAdjustmentInput = z.infer<typeof pointsAdjustmentSchema>;

export const membersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().max(500).optional(),
  })
  .strict();
export type MembersQuery = z.infer<typeof membersQuerySchema>;
