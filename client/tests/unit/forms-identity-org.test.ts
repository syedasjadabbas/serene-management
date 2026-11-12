import { describe, expect, it } from "vitest";
import {
  resetPasswordDefaults,
  resetPasswordFormSchema,
} from "@/app/(auth)/reset-password/_lib/resetPasswordForm";
import {
  changePasswordDefaults,
  changePasswordFormSchema,
  toChangePasswordBody,
} from "@/global/components/workspace/changePasswordForm";
import { profileFormSchema } from "@/global/components/workspace/profileForm";
import {
  createPropertyDefaults,
  createPropertyFormSchema,
  toCreatePropertyBody,
} from "@/app/(workspace)/organization/properties/_lib/propertyForms";
import {
  inviteFormDefaults,
  inviteFormSchema,
  reasonFormSchema,
  toGrantBody,
  toInviteBody,
} from "@/app/(workspace)/organization/users/_lib/userForms";

function messages(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return Object.fromEntries(
    (result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]),
  );
}

describe("password forms", () => {
  it("requires matching confirmation and minimum length", () => {
    const short = resetPasswordFormSchema.safeParse({ newPassword: "abc", confirm: "abc" });
    expect(short.success).toBe(false);
    const mismatch = resetPasswordFormSchema.safeParse({
      newPassword: "x".repeat(14),
      confirm: "y",
    });
    expect(messages(mismatch).confirm).toBe("The passwords do not match");
    expect(
      resetPasswordFormSchema.safeParse({ newPassword: "x".repeat(14), confirm: "x".repeat(14) })
        .success,
    ).toBe(true);
    expect(resetPasswordDefaults).toEqual({ newPassword: "", confirm: "" });
  });
  it("change password drops the repetition from the body", () => {
    const values = { currentPassword: "old", newPassword: "n".repeat(14), confirm: "n".repeat(14) };
    expect(changePasswordFormSchema.safeParse(values).success).toBe(true);
    expect(toChangePasswordBody(values)).toEqual({
      currentPassword: "old",
      newPassword: "n".repeat(14),
    });
    expect(
      messages(changePasswordFormSchema.safeParse(changePasswordDefaults)).currentPassword,
    ).toBe("Enter your current password");
  });
});

describe("profile and user forms", () => {
  it("trims the display name and rejects an empty one", () => {
    expect(profileFormSchema.parse({ displayName: "  Ada  " }).displayName).toBe("Ada");
    expect(profileFormSchema.safeParse({ displayName: "  " }).success).toBe(false);
  });
  it("invite builds the role body by scope", () => {
    const values = {
      ...inviteFormDefaults("r1", "ORGANIZATION"),
      displayName: " Ada Lovelace ",
      email: " ADA@x.com ",
      reason: " onboarding ",
    };
    const parsed = inviteFormSchema.parse(values);
    expect(toInviteBody(parsed)).toEqual({
      email: "ADA@x.com",
      displayName: "Ada Lovelace",
      role: { scope: "ORGANIZATION", roleId: "r1" },
      reason: "onboarding",
    });
    expect(toGrantBody({ roleId: "r1", scope: "p9", reason: "why" })).toEqual({
      scope: "PROPERTY",
      roleId: "r1",
      propertyId: "p9",
      reason: "why",
    });
    expect(reasonFormSchema.safeParse({ reason: "ab" }).success).toBe(false);
  });
});

describe("create property form", () => {
  const filled = {
    ...createPropertyDefaults,
    code: "khi",
    name: "Karachi",
    timezone: "Asia/Karachi",
    currencyCode: "pkr",
    countryCode: "pk",
    reason: "new hotel",
  };
  it("normalizes and omits an empty prefix", () => {
    const body = toCreatePropertyBody(createPropertyFormSchema.parse(filled));
    expect(body).toEqual({
      code: "KHI",
      name: "Karachi",
      timezone: "Asia/Karachi",
      currencyCode: "PKR",
      countryCode: "PK",
      reason: "new hotel",
    });
    expect(
      toCreatePropertyBody(createPropertyFormSchema.parse({ ...filled, confirmationPrefix: "kh" }))
        .confirmationPrefix,
    ).toBe("KH");
  });
  it("reports field messages", () => {
    const m = messages(createPropertyFormSchema.safeParse(createPropertyDefaults));
    expect(Object.keys(m)).toEqual(expect.arrayContaining(["code", "name", "reason"]));
  });
});
