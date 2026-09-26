import { describe, expect, it } from "vitest";
import {
  confirmationCandidates,
  formatConfirmationNumber,
  parseConfirmationNumber,
} from "@/modules/properties/confirmation-number.policy";

describe("confirmation numbers (D36)", () => {
  it("formats the property prefix and the sequence value", () => {
    expect(formatConfirmationNumber("SMR", 100045n)).toBe("SMR-100045");
  });

  it("parses prefixed, legacy and share-suffixed numbers case-insensitively", () => {
    expect(parseConfirmationNumber("SMR-100045")).toEqual({ prefix: "SMR", number: "100045" });
    expect(parseConfirmationNumber(" smr-100045-2 ")).toEqual({ prefix: "SMR", number: "100045" });
    expect(parseConfirmationNumber("100029")).toEqual({ prefix: null, number: "100029" });
    expect(parseConfirmationNumber("100029-3")).toEqual({ prefix: null, number: "100029" });
  });

  it("rejects text that cannot be a confirmation number", () => {
    for (const raw of ["Rossi", "SMR", "SMR-", "1-100045", "12", "S-100045", "SMR-100045-2-1"]) {
      expect(parseConfirmationNumber(raw)).toBeNull();
    }
  });

  it("matches exactly with a prefix, and legacy or any prefix with digits only", () => {
    expect(confirmationCandidates({ prefix: "SDX", number: "100016" })).toEqual({
      equals: ["SDX-100016"],
      endsWith: null,
    });
    expect(confirmationCandidates({ prefix: null, number: "100016" })).toEqual({
      equals: ["100016"],
      endsWith: "-100016",
    });
  });
});
