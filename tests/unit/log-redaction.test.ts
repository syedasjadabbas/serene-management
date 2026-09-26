import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, logServerError, redact } from "@/lib/http/log";

describe("server error logging (G12)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("masks e-mail addresses, secrets, bearer tokens and connection strings", () => {
    const text = redact(
      "user ali@example.com password=hunter2 token: abc Bearer eyJhbGciOi.x.y postgres://app:pw@localhost/db " +
        "k".repeat(40),
    );
    expect(text).not.toMatch(/ali@example\.com|hunter2|eyJhbGciOi|app:pw|k{40}/);
    expect(text).toContain("[email]");
    expect(text).toContain("password=[redacted]");
  });

  it("logs database errors by code only, never their message or values", () => {
    const pgError = Object.assign(
      new Error("duplicate key value violates unique constraint; Key (email)=(ali@example.com)"),
      { code: "23505", detail: "Key (email)=(ali@example.com) already exists." },
    );
    expect(describeError(pgError)).toEqual({ name: "Error", code: "23505" });

    const prismaError = Object.assign(
      new Error("Invalid `prisma.guest.create()` invocation: { email: 'x@y.z' }"),
      {
        name: "PrismaClientValidationError",
      },
    );
    expect(describeError(prismaError)).toEqual({
      name: "PrismaClientValidationError",
      code: undefined,
    });
  });

  it("writes the request id and the redacted description", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("Unhandled error", new Error("lookup failed for ali@example.com"), "req-1");
    const [label, logged] = spy.mock.calls[0]!;
    expect(label).toBe("[req-1] Unhandled error");
    expect(JSON.stringify(logged)).not.toContain("ali@example.com");
  });
});
