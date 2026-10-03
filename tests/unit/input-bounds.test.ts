import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { isoDateSchema } from "@/lib/validation/common";
import { chargeSchema } from "@/modules/billing/billing.schema";

// PRODUCTION_READINESS P2-4: malformed input must answer 400 (validation), never reach PostgreSQL.
const ID = "01a0d350-636d-74eb-af36-ccd665749e52";

describe("cursor values are checked against their comparison type", () => {
  it("round-trips a valid cursor", () => {
    const cursor = encodeCursor({ c: "2026-09-24T10:00:00.000Z", i: ID });
    expect(decodeCursor(cursor, ["c", "i"] as const, { c: "timestamp" })).toEqual({
      c: "2026-09-24T10:00:00.000Z",
      i: ID,
    });
  });

  it("rejects a row id that is not a uuid", () => {
    expect(decodeCursor(encodeCursor({ v: "Smith", i: "not-a-uuid" }), ["v", "i"] as const)).toBeNull();
    expect(decodeCursor(encodeCursor({ v: "Smith", i: "' OR 1=1 --" }), ["v", "i"] as const)).toBeNull();
  });

  it("rejects impossible dates and timestamps", () => {
    for (const a of ["0000-01-01", "2026-02-30", "2026-13-01", "yesterday", "1899-12-31"]) {
      expect(decodeCursor(encodeCursor({ a, i: ID }), ["a", "i"] as const, { a: "date" })).toBeNull();
    }
    for (const c of ["not a time", "0000-01-01T00:00:00Z", "9999-01-01T00:00:00Z"]) {
      expect(decodeCursor(encodeCursor({ c, i: ID }), ["c", "i"] as const, { c: "timestamp" })).toBeNull();
    }
    expect(decodeCursor(encodeCursor({ a: "2026-09-24", i: ID }), ["a", "i"] as const, { a: "date" })).not.toBeNull();
  });

  it("rejects oversized values, missing keys and garbage", () => {
    expect(decodeCursor(encodeCursor({ v: "x".repeat(501), i: ID }), ["v", "i"] as const)).toBeNull();
    expect(decodeCursor(encodeCursor({ v: "Smith" }), ["v", "i"] as const)).toBeNull();
    expect(decodeCursor("%%%not-base64%%%", ["v", "i"] as const)).toBeNull();
  });
});

describe("dates on the wire are bounded", () => {
  it("accepts 1900–2199 and refuses year 0000 and far-future years", () => {
    expect(isoDateSchema.safeParse("1900-01-01").success).toBe(true);
    expect(isoDateSchema.safeParse("2199-12-31").success).toBe(true);
    expect(isoDateSchema.safeParse("0000-01-01").success).toBe(false);
    expect(isoDateSchema.safeParse("1899-12-31").success).toBe(false);
    expect(isoDateSchema.safeParse("2200-01-01").success).toBe(false);
  });
});

describe("a posting's quantity × price stays inside numeric(19,4)", () => {
  const base = { transactionCodeId: ID, quantity: 1, unitAmount: "100.00" };
  it("accepts normal postings and refuses oversized totals", () => {
    expect(chargeSchema.safeParse(base).success).toBe(true);
    expect(chargeSchema.safeParse({ ...base, quantity: 999, unitAmount: "1000000000.00" }).success).toBe(true);
    expect(chargeSchema.safeParse({ ...base, quantity: 999, unitAmount: "9999999999999.9999" }).success).toBe(false);
    expect(chargeSchema.safeParse({ ...base, quantity: 2, unitAmount: "999999999999.0000" }).success).toBe(false);
  });
});
