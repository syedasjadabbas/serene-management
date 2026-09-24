import { z } from "zod";
import { highRiskReasonSchema, idSchema, offsetPageQuerySchema } from "@/lib/validation/common";

export const userParamsSchema = z.object({ userId: idSchema }).strict();
export const roleAssignmentParamsSchema = z
  .object({ userId: idSchema, assignmentId: idSchema })
  .strict();

export const listUsersQuerySchema = offsetPageQuerySchema
  .extend({ q: z.string().trim().min(1).max(100).optional() })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const grantRoleSchema = z.discriminatedUnion("scope", [
  highRiskReasonSchema.extend({ scope: z.literal("ORGANIZATION"), roleId: idSchema }).strict(),
  highRiskReasonSchema
    .extend({ scope: z.literal("PROPERTY"), roleId: idSchema, propertyId: idSchema })
    .strict(),
]);

export type GrantRoleInput = z.infer<typeof grantRoleSchema>;

/** Body of revoke / disable / unlock: a mandatory justification. */
export const reasonOnlySchema = highRiskReasonSchema.strict();
export type ReasonOnlyInput = z.infer<typeof reasonOnlySchema>;
