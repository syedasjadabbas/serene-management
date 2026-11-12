import { describe, expect, it } from "vitest";
import { retryDelayMs, unwrapEnvelope } from "@/global/api/baseApi";
import { filenameFromDisposition } from "@/global/api/download";
import { statusFallback, toClientApiError } from "@/global/api/errors";

describe("success envelope", () => {
  it("is reduced to { data, meta } for endpoint transformResponse functions", () => {
    const meta = { nextCursor: "c2", limit: 25 };
    expect(unwrapEnvelope({ success: true, message: "OK", data: [1, 2], meta })).toEqual({
      data: [1, 2],
      meta,
    });
  });

  it("omits meta when the server sends none", () => {
    expect(unwrapEnvelope({ success: true, message: "OK", data: { id: "a" } })).toEqual({
      data: { id: "a" },
    });
  });

  it("passes non-envelope bodies (empty replies) through", () => {
    expect(unwrapEnvelope(null)).toBeNull();
    expect(unwrapEnvelope({ something: 1 })).toEqual({ something: 1 });
  });
});

describe("error envelope", () => {
  const body = {
    success: false,
    message: "Room is already assigned.",
    error: {
      code: "CONFLICT",
      details: { fields: { roomId: ["Pick another room"] }, reason: "OVERLAP" },
      requestId: "req-1",
    },
  };

  it("reaches the UI with code, message, field errors, details and request id", () => {
    expect(toClientApiError({ status: 409, data: body })).toEqual({
      code: "CONFLICT",
      message: "Room is already assigned.",
      status: 409,
      requestId: "req-1",
      fieldErrors: { roomId: ["Pick another room"] },
      details: body.error.details,
    });
  });

  it("keeps 401 reason codes", () => {
    const error = toClientApiError({
      status: 401,
      data: { success: false, message: "Account disabled.", error: { code: "ACCOUNT_DISABLED" } },
    });
    expect(error).toMatchObject({ code: "ACCOUNT_DISABLED", message: "Account disabled." });
  });

  it("still reads a message inside `error`", () => {
    const error = toClientApiError({
      status: 403,
      data: { error: { code: "FORBIDDEN", message: "No." } },
    });
    expect(error?.message).toBe("No.");
  });

  it("falls back per status when the body is not an envelope", () => {
    expect(toClientApiError({ status: 404, data: "<html>" })).toMatchObject({
      code: statusFallback(404).code,
      message: statusFallback(404).message,
      status: 404,
    });
  });

  it("distinguishes no reply from a reply", () => {
    const error = toClientApiError({ status: "FETCH_ERROR", error: "x" });
    expect(error?.message).toMatch(/Cannot reach the server/);
  });
});

describe("retry delay", () => {
  it("honours Retry-After seconds (capped) and dates", () => {
    expect(retryDelayMs(0, "2")).toBe(2000);
    expect(retryDelayMs(0, "999")).toBe(10_000);
    expect(retryDelayMs(0, new Date(5_000).toUTCString(), 2_000)).toBe(3000);
  });

  it("backs off exponentially without a header", () => {
    expect(retryDelayMs(0, null)).toBe(400);
    expect(retryDelayMs(1, null)).toBe(800);
  });
});

describe("download file names", () => {
  it("reads Content-Disposition", () => {
    expect(filenameFromDisposition('attachment; filename="arrivals-2026-11-12.csv"', "x.csv")).toBe(
      "arrivals-2026-11-12.csv",
    );
    expect(
      filenameFromDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.csv", "x.csv"),
    ).toBe("résumé.csv");
    expect(filenameFromDisposition(null, "x.csv")).toBe("x.csv");
  });
});
