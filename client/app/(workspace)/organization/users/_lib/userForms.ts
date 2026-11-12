import { z } from "zod";
import { highRiskReasonSchema } from "@serene/shared/lib/validation/common";

/** Reason recorded in the audit trail (trimmed, at least 3 characters). */
export const reasonFieldSchema = highRiskReasonSchema.shape.reason;

export const reasonFormSchema = z.object({ reason: reasonFieldSchema });
export const reasonFormDefaults = { reason: "" };

const roleScopeFields = {
  roleId: z.string().min(1, "Choose a role"),
  scope: z.string().min(1, "Choose a scope"),
  reason: reasonFieldSchema,
};

export const inviteFormSchema = z.object({
  displayName: z.string().trim().min(2, "Enter the full name (at least 2 characters)").max(120),
  email: z.string().trim().pipe(z.email("Enter a valid e-mail address").max(254)),
  ...roleScopeFields,
});

export const grantFormSchema = z.object(roleScopeFields);

export function inviteFormDefaults(roleId: string, scope: string) {
  return { displayName: "", email: "", roleId, scope, reason: "" };
}

export function grantFormDefaults(roleId: string, scope: string) {
  return { roleId, scope, reason: "" };
}

/** The scope picker's value is "ORGANIZATION" or a property id. */
export function toRoleBody(values: { roleId: string; scope: string }) {
  return values.scope === "ORGANIZATION"
    ? { scope: "ORGANIZATION" as const, roleId: values.roleId }
    : { scope: "PROPERTY" as const, roleId: values.roleId, propertyId: values.scope };
}

export function toInviteBody(values: z.output<typeof inviteFormSchema>) {
  return {
    email: values.email,
    displayName: values.displayName,
    role: toRoleBody(values),
    reason: values.reason,
  };
}

export function toGrantBody(values: z.output<typeof grantFormSchema>) {
  return { ...toRoleBody(values), reason: values.reason };
}
