import { z } from "zod";
import { cursorPageQuerySchema, idSchema, isoDateSchema } from "@/lib/validation/common";

export const auditLogQuerySchema = cursorPageQuerySchema
  .extend({
    risk: z.enum(["LOW", "STANDARD", "HIGH"]).optional(),
    resourceType: z.string().trim().min(1).max(60).optional(),
    resourceId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/**
 * Organization audit trail (Phase 9): rows of every property the caller may
 * audit, plus organization-level rows with an organization grant. `scope`
 * narrows to one property or to organization-level rows ("organization").
 * Dates filter `created_at` by UTC calendar day.
 */
export const organizationAuditLogQuerySchema = auditLogQuerySchema
  .extend({
    scope: z.union([idSchema, z.literal("organization")]).optional(),
    action: z
      .string()
      .trim()
      .regex(/^[a-z_.]{2,80}$/, "Letters, dots and underscores")
      .optional(),
    userId: idSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ["to"],
    message: "Must be on or after the start date",
  });

export type OrganizationAuditLogQuery = z.infer<typeof organizationAuditLogQuerySchema>;
