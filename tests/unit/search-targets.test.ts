import { describe, expect, it } from "vitest";
import { profileTargetCode } from "@/components/workspace/searchTargets";

const scope = (properties: { code: string; permissions: string[] }[], isSuperAdmin = false) => ({
  user: { isSuperAdmin },
  properties,
});

describe("profileTargetCode (global search routing of guests and companies)", () => {
  it("chooses only a property that grants the record's read permission", () => {
    const s = scope([
      { code: "AAA", permissions: ["reservations:read"] },
      { code: "BBB", permissions: ["guests:read"] },
    ]);
    expect(profileTargetCode(s, "guests:read")).toBe("BBB");
    expect(profileTargetCode(s, "accounts:read")).toBeNull();
  });

  it("resolves guests and companies independently when they are granted at different properties", () => {
    const s = scope([
      { code: "AAA", permissions: ["accounts:read"] },
      { code: "BBB", permissions: ["guests:read"] },
    ]);
    expect(profileTargetCode(s, "guests:read")).toBe("BBB");
    expect(profileTargetCode(s, "accounts:read")).toBe("AAA");
  });

  it("is deterministic across several permitted properties (lowest code)", () => {
    const s = scope([
      { code: "SMR", permissions: ["guests:read"] },
      { code: "CTY", permissions: ["guests:read"] },
      { code: "DXB", permissions: ["guests:read"] },
    ]);
    expect(profileTargetCode(s, "guests:read")).toBe("CTY");
  });

  it("returns null when the user has no property at all", () => {
    expect(profileTargetCode(scope([]), "guests:read")).toBeNull();
    expect(profileTargetCode(scope([], true), "guests:read")).toBeNull();
  });

  it("gives a super admin the lowest accessible property, never an unlisted one", () => {
    const s = scope(
      [
        { code: "ZED", permissions: [] },
        { code: "MID", permissions: [] },
      ],
      true,
    );
    expect(profileTargetCode(s, "accounts:read")).toBe("MID");
  });
});
