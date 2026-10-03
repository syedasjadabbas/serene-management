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

/**
 * Adds a user to the organization (docs/RBAC.md: `users:manage` covers
 * invitations). The first role is required: a user without one can do
 * nothing. The account stays INVITED until the person sets a password with
 * the one-time link the administrator receives.
 */
export const inviteUserSchema = highRiskReasonSchema
  .extend({
    email: z
      .email("Enter a valid e-mail address")
      .max(254)
      .transform((value) => value.trim().toLowerCase()),
    displayName: z.string().trim().min(2, "Enter the person's name").max(120),
    role: z.discriminatedUnion("scope", [
      z.object({ scope: z.literal("ORGANIZATION"), roleId: idSchema }).strict(),
      z.object({ scope: z.literal("PROPERTY"), roleId: idSchema, propertyId: idSchema }).strict(),
    ]),
  })
  .strict();

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
