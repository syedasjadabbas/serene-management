import { describe, expect, it } from "vitest";
import {
  cursorPageQuerySchema,
  isoDateSchema,
  moneyAmountSchema,
  sortQuerySchema,
} from "@/lib/validation/common";

describe("shared validation primitives", () => {
  it("accepts decimal money strings and rejects floats-as-numbers", () => {
    expect(moneyAmountSchema.safeParse("1250.00").success).toBe(true);
    expect(moneyAmountSchema.safeParse("-10.5").success).toBe(true);
    expect(moneyAmountSchema.safeParse("1.23456").success).toBe(false);
    expect(moneyAmountSchema.safeParse(12.5).success).toBe(false);
  });

  it("accepts calendar dates only", () => {
    expect(isoDateSchema.safeParse("2026-09-24").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-09-24T10:00:00Z").success).toBe(false);
  });

  it("caps page size", () => {
    expect(cursorPageQuerySchema.parse({}).limit).toBe(50);
    expect(cursorPageQuerySchema.safeParse({ limit: "5000" }).success).toBe(false);
  });

  it("parses allow-listed sort fields", () => {
    const sort = sortQuerySchema(["arrivalDate", "lastName"]);
    expect(sort.parse("arrivalDate,-lastName")).toEqual([
      { field: "arrivalDate", direction: "asc" },
      { field: "lastName", direction: "desc" },
    ]);
    expect(sort.safeParse("passwordHash").success).toBe(false);
  });
});
