import { describe, expect, it, vi } from "vitest";
import type { ClientApiError } from "@/global/api/errors";
import { applyServerError, mapServerFieldErrors } from "@/global/components/ui/form/serverErrors";
import { loginFormDefaults, loginFormSchema } from "@/app/(auth)/login/_lib/loginForm";
import { loginSchema } from "@serene/shared/modules/identity/identity.schema";
import {
  extendStayDefaults,
  extendStayFormSchema,
} from "@/app/(workspace)/[propertyCode]/front-desk/stays/[stayId]/_lib/extendStayForm";

function apiError(fieldErrors: Record<string, string[]>): ClientApiError {
  return {
    code: "VALIDATION_FAILED",
    message: "Invalid",
    status: 400,
    requestId: null,
    fieldErrors,
    details: {},
  };
}

describe("server field error mapping", () => {
  it("maps every field when no field list is given", () => {
    expect(mapServerFieldErrors({ email: ["Taken", "x"], name: ["Required"] })).toEqual({
      fields: [
        ["email", "Taken"],
        ["name", "Required"],
      ],
      unmapped: [],
    });
  });

  it("separates fields the form does not have", () => {
    expect(mapServerFieldErrors({ email: ["Taken"], other: ["Bad"] }, ["email"])).toEqual({
      fields: [["email", "Taken"]],
      unmapped: ["other: Bad"],
    });
  });

  it("skips empty message lists", () => {
    expect(mapServerFieldErrors({ email: [] }).fields).toEqual([]);
  });

  it("calls setError once per known field with type 'server'", () => {
    const setError = vi.fn();
    const mapped = applyServerError(setError, apiError({ email: ["Taken"], x: ["y"] }), ["email"]);
    expect(mapped).toBe(true);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("email", { type: "server", message: "Taken" });
  });

  it("does nothing without an error or without field errors", () => {
    const setError = vi.fn();
    expect(applyServerError(setError, null)).toBe(false);
    expect(applyServerError(setError, apiError({}))).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });
});

describe("login form schema", () => {
  it("keeps the messages the form has always shown", () => {
    const result = loginFormSchema.safeParse(loginFormDefaults);
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toContain("Enter a valid email address");
    expect(messages).toContain("Enter your password");
  });

  it("produces output the shared loginSchema accepts", () => {
    const parsed = loginFormSchema.parse({ email: "  Name@Hotel.com ", password: "secret" });
    expect(parsed.email).toBe("name@hotel.com");
    expect(loginSchema.safeParse(parsed).success).toBe(true);
  });
});

describe("extend stay form schema", () => {
  const schema = extendStayFormSchema("2026-12-10");

  it("defaults to the day after the current departure", () => {
    expect(extendStayDefaults("2026-12-10")).toEqual({
      departure: "2026-12-11",
      override: false,
      reason: "",
    });
    expect(schema.safeParse(extendStayDefaults("2026-12-10")).success).toBe(true);
  });

  it("rejects a departure that is not later", () => {
    const result = schema.safeParse({ departure: "2026-12-10", override: false, reason: "" });
    expect(result.success).toBe(false);
  });

  it("requires a 3 character reason only with an override", () => {
    const base = { departure: "2026-12-12", override: true };
    expect(schema.safeParse({ ...base, reason: " ab " }).success).toBe(false);
    expect(schema.safeParse({ ...base, reason: "abc" }).success).toBe(true);
    expect(schema.safeParse({ ...base, override: false, reason: "" }).success).toBe(true);
  });
});
