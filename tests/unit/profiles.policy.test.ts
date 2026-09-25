import { describe, expect, it } from "vitest";
import {
  dateOfBirthProblem,
  duplicateContactValue,
  duplicatePrimary,
  guestDisplayName,
  noteVisible,
  phoneDigits,
} from "@/modules/guests/guests.policy";
import {
  adjustedBalance,
  membershipChangeProblem,
  membershipNumber,
  parsePoints,
} from "@/modules/loyalty/loyalty.policy";
import { negotiatedFor } from "@/modules/rates/rates.policy";

describe("guest policy", () => {
  it("keeps only the digits of a phone number for search", () => {
    expect(phoneDigits("+44 (20) 7946-0018")).toBe("442079460018");
    expect(phoneDigits("  ")).toBeNull();
    expect(phoneDigits(null)).toBeNull();
  });

  it("addresses the guest by the preferred name when set", () => {
    expect(guestDisplayName({ preferredName: "Bob", firstName: "Robert", lastName: "Stone" })).toBe(
      "Bob Stone",
    );
    expect(guestDisplayName({ preferredName: null, firstName: "Robert", lastName: "Stone" })).toBe(
      "Robert Stone",
    );
  });

  it("restricts management and internal notes to guests:read_sensitive", () => {
    expect(noteVisible("ALL_STAFF", false)).toBe(true);
    expect(noteVisible("MANAGEMENT", false)).toBe(false);
    expect(noteVisible("INTERNAL", false)).toBe(false);
    expect(noteVisible("INTERNAL", true)).toBe(true);
  });

  it("accepts only past dates of birth after 1900", () => {
    expect(dateOfBirthProblem("1990-05-01", "2026-09-25")).toBeNull();
    expect(dateOfBirthProblem("2026-09-25", "2026-09-25")).toMatch(/past/);
    expect(dateOfBirthProblem("1899-12-31", "2026-09-25")).toMatch(/too far/);
  });

  it("allows one primary contact per type and no repeated values", () => {
    expect(
      duplicatePrimary([
        { type: "EMAIL", isPrimary: true },
        { type: "MOBILE", isPrimary: true },
        { type: "EMAIL", isPrimary: false },
      ]),
    ).toBeNull();
    expect(
      duplicatePrimary([
        { type: "EMAIL", isPrimary: true },
        { type: "EMAIL", isPrimary: true },
      ]),
    ).toBe("EMAIL");
    expect(
      duplicateContactValue([
        { type: "EMAIL", value: "A@x.com" },
        { type: "EMAIL", value: "a@x.com" },
      ]),
    ).toBe("a@x.com");
    expect(
      duplicateContactValue([
        { type: "MOBILE", value: "+44 7700 900123" },
        { type: "MOBILE", value: "447700900123" },
      ]),
    ).toBe("447700900123");
    expect(
      duplicateContactValue([
        { type: "MOBILE", value: "+44 7700 900123" },
        { type: "PHONE", value: "+44 7700 900123" },
      ]),
    ).toBeNull();
  });
});

describe("loyalty policy", () => {
  it("works in whole points and never lets the balance go negative", () => {
    expect(parsePoints("500")).toBe(500n);
    expect(parsePoints("-200")).toBe(-200n);
    expect(parsePoints("12.5")).toBeNull();
    expect(adjustedBalance(300n, -300n)).toBe(0n);
    expect(adjustedBalance(300n, -301n)).toBeNull();
  });

  it("validates tier and status changes", () => {
    const active = { tierId: "t1", status: "ACTIVE" as const };
    expect(membershipChangeProblem(active, { tierId: "t1" }, null)).toBe("Nothing to change");
    expect(
      membershipChangeProblem(active, { tierId: "t2" }, { programMatches: false, active: true }),
    ).toMatch(/does not belong/);
    expect(
      membershipChangeProblem(active, { tierId: "t2" }, { programMatches: true, active: false }),
    ).toMatch(/not active/);
    expect(
      membershipChangeProblem(active, { tierId: "t2" }, { programMatches: true, active: true }),
    ).toBeNull();
    expect(membershipChangeProblem(active, { tierId: null }, null)).toBeNull();
    const inactive = { tierId: "t1", status: "INACTIVE" as const };
    expect(
      membershipChangeProblem(inactive, { tierId: "t2" }, { programMatches: true, active: true }),
    ).toMatch(/Re-activate/);
    expect(
      membershipChangeProblem(
        inactive,
        { tierId: "t2", status: "ACTIVE" },
        { programMatches: true, active: true },
      ),
    ).toBeNull();
  });

  it("builds membership numbers from the program code", () => {
    expect(membershipNumber("SRW", "0001234")).toBe("SRW0001234");
  });
});

describe("negotiated rates", () => {
  const plan = {
    negotiated: [
      {
        accountProfileId: "acme",
        validFrom: new Date("2026-10-01T00:00:00Z"),
        validTo: new Date("2026-12-31T00:00:00Z"),
      },
      { accountProfileId: "open", validFrom: null, validTo: null },
    ],
  };

  it("sells only to linked companies, inside the validity window", () => {
    expect(negotiatedFor(plan, null, "2026-10-05", "2026-10-06")).toBe(false);
    expect(negotiatedFor(plan, "rival", "2026-10-05", "2026-10-06")).toBe(false);
    expect(negotiatedFor(plan, "acme", "2026-10-05", "2026-10-06")).toBe(true);
    expect(negotiatedFor(plan, "acme", "2026-09-30", "2026-10-02")).toBe(false);
    expect(negotiatedFor(plan, "acme", "2026-12-30", "2026-12-31")).toBe(true);
    expect(negotiatedFor(plan, "acme", "2026-12-30", "2027-01-01")).toBe(false);
    expect(negotiatedFor(plan, "open", "2030-01-01", "2030-01-10")).toBe(true);
  });
});
