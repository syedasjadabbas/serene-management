import { describe, expect, it } from "vitest";
import { useBookingDraft } from "@/app/(workspace)/[propertyCode]/reservations/new/store/bookingDraft.store";
import { canUseOrganizationWorkspace, switchHref } from "@/components/workspace/sections";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import type { Permission } from "@/lib/permissions/catalog";
import type { MeView } from "@/modules/access/access.types";

const property = (id: string, code: string, permissions: Permission[]) => ({
  id,
  code,
  name: code,
  timezone: "Asia/Karachi",
  currencyCode: "PKR",
  permissions,
});

const me = (overrides: Partial<MeView> = {}): MeView => ({
  user: { id: "u", email: "u@x", displayName: "U", locale: "en", isSuperAdmin: false },
  organization: { id: "o", code: "O", name: "Org", baseCurrency: "PKR" },
  organizationPermissions: [],
  properties: [
    property("a", "SMR", ["reports:read", "reservations:read", "billing:read"]),
    property("b", "SDX", ["reservations:read"]),
  ],
  defaultPropertyCode: "SMR",
  ...overrides,
});

describe("property switcher (Phase 9)", () => {
  it("keeps the section when the target property grants it", () => {
    const user = me();
    expect(switchHref(user, user.properties[1]!, "/SMR/reservations")).toBe("/SDX/reservations");
    // Record ids belong to one property: only the section is kept.
    expect(switchHref(user, user.properties[1]!, "/SMR/reservations/0192-abc")).toBe(
      "/SDX/reservations",
    );
  });

  it("falls back to the overview when the target lacks the permission", () => {
    const user = me();
    expect(switchHref(user, user.properties[1]!, "/SMR/reports")).toBe("/SDX");
    expect(switchHref(user, user.properties[1]!, "/SMR/billing")).toBe("/SDX");
    expect(switchHref(user, user.properties[1]!, "/SMR")).toBe("/SDX");
    expect(switchHref(user, user.properties[1]!, "/SMR/unknown-section")).toBe("/SDX");
  });

  it("offers the organization workspace to multi-property and organization-scope users only", () => {
    expect(canUseOrganizationWorkspace(me())).toBe(true);
    const single = me({ properties: [property("a", "SMR", ["reports:read"])] });
    expect(canUseOrganizationWorkspace(single)).toBe(false);
    expect(
      canUseOrganizationWorkspace({ ...single, organizationPermissions: ["audit:read"] }),
    ).toBe(true);
  });
});

describe("booking draft isolation", () => {
  it("binds the draft to one property and clears it on reset", () => {
    const store = useBookingDraft.getState();
    store.reset("property-a");
    useBookingDraft.getState().setGuest({ id: "guest-1", label: "Guest" });
    useBookingDraft.getState().setDetails({ roomId: "room-of-a", marketCodeId: "market-of-a" });
    expect(useBookingDraft.getState().propertyId).toBe("property-a");
    useBookingDraft.getState().reset("property-b");
    const next = useBookingDraft.getState();
    expect(next.propertyId).toBe("property-b");
    expect(next.guest).toBeNull();
    expect(next.details.roomId).toBe("");
    expect(next.details.marketCodeId).toBe("");
  });
});

describe("bounded fan-out", () => {
  it("never runs more than the limit at once and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5 + (n % 3)));
      inFlight -= 1;
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
