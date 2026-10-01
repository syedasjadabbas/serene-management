import { describe, expect, it } from "vitest";
import { isCurrentSearch, searchResultRoute } from "@/modules/search/search.policy";
import type { SearchHitView } from "@/modules/search/search.types";

const ID = "01890a5d-ac96-774b-bcce-b302099a8057";
const hit = (over: Partial<SearchHitView>) => ({
  type: "guests" as const,
  propertyCode: "SMR",
  targetId: ID,
  ...over,
});

describe("searchResultRoute (routes are built from the type, never taken from a response)", () => {
  it.each([
    ["reservations", `/SMR/reservations/${ID}`],
    ["guests", `/SMR/guests/${ID}`],
    ["folios", `/SMR/billing/${ID}`],
    ["companies", `/SMR/companies/${ID}`],
    ["groups", `/SMR/groups/${ID}`],
    ["maintenance", `/SMR/maintenance/${ID}`],
    ["ratePlans", `/SMR/rates/${ID}`],
  ] as const)("%s", (type, route) => {
    expect(searchResultRoute(hit({ type }))).toBe(route);
  });

  it("opens rooms on the board the server chose, and nowhere without one", () => {
    expect(searchResultRoute(hit({ type: "rooms", roomView: "housekeeping" }))).toBe(
      `/SMR/housekeeping?room=${ID}`,
    );
    expect(searchResultRoute(hit({ type: "rooms", roomView: "front-desk" }))).toBe(
      `/SMR/front-desk?view=rooms&room=${ID}`,
    );
    expect(searchResultRoute(hit({ type: "rooms" }))).toBeNull();
  });

  it("refuses results without a property, with malformed codes or ids, or of unknown types", () => {
    expect(searchResultRoute(hit({ propertyCode: null }))).toBeNull();
    for (const propertyCode of ["", "../admin", "SMR/x", "//evil.example", "a".repeat(21)]) {
      expect(searchResultRoute(hit({ propertyCode }))).toBeNull();
    }
    for (const targetId of ["", "123", `${ID}/../../x`, `${ID}?next=//evil`]) {
      expect(searchResultRoute(hit({ targetId }))).toBeNull();
    }
    expect(
      searchResultRoute(hit({ type: "javascript" as unknown as SearchHitView["type"] })),
    ).toBeNull();
  });
});

describe("isCurrentSearch (stale responses never replace newer results)", () => {
  const now = { q: "khan", propertyId: "p1" };

  it("accepts the response to the text and property on screen", () => {
    expect(isCurrentSearch({ query: "khan" }, { q: "khan", propertyId: "p1" }, now)).toBe(true);
  });

  it("rejects an earlier keystroke, another property, or no response yet", () => {
    expect(isCurrentSearch({ query: "kha" }, { q: "kha", propertyId: "p1" }, now)).toBe(false);
    expect(isCurrentSearch({ query: "khan" }, { q: "khan", propertyId: "p2" }, now)).toBe(false);
    expect(isCurrentSearch({ query: "kha" }, { q: "khan", propertyId: "p1" }, now)).toBe(false);
    expect(isCurrentSearch(undefined, { q: "khan", propertyId: "p1" }, now)).toBe(false);
    expect(isCurrentSearch({ query: "khan" }, undefined, now)).toBe(false);
  });

  it("keeps the organization search apart from a property's", () => {
    const org = { q: "khan", propertyId: null };
    expect(isCurrentSearch({ query: "khan" }, { q: "khan", propertyId: null }, org)).toBe(true);
    expect(isCurrentSearch({ query: "khan" }, { q: "khan", propertyId: "p1" }, org)).toBe(false);
  });
});
