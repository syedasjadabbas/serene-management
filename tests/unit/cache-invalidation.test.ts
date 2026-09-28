import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { afterFinancial } from "@/lib/api/endpoints/billing.api";
import { operationsTags } from "@/lib/api/endpoints/operations-tags";

/**
 * B11: financial commands refresh what they can change — the folio account,
 * the touched ledger windows, history, the property's lists and the stay's
 * folio summary — instead of every cached folio, payment and stay.
 */

const P = "prop-1";
const RR = "rr-1";

describe("financial cache invalidation (B11)", () => {
  it("targets one folio account, its ledger and its property's lists", () => {
    const tags = afterFinancial(undefined, undefined, {
      propertyId: P,
      reservationRoomId: RR,
      folioId: "folio-1",
    });
    expect(tags).toEqual(
      expect.arrayContaining([
        { type: "Folio", id: RR },
        { type: "Folio", id: `HISTORY-${RR}` },
        { type: "Folio", id: `LIST-${P}` },
        { type: "Folio", id: "LEDGER-folio-1" },
        { type: "Stay", id: `RR-${RR}` },
        { type: "Stay", id: `FD-${P}` },
      ]),
    );
    // Every tag carries an id: nothing invalidates a whole tag type.
    expect(tags.every((tag) => typeof tag === "object" && typeof tag.id === "string")).toBe(true);
    expect(tags.some((tag) => tag.id.includes("prop-2") || tag.id.includes("rr-2"))).toBe(false);
  });

  it("uses the result's window when the command addressed an item or payment", () => {
    const tags = afterFinancial({ folioId: "folio-2", itemIds: [] }, undefined, {
      propertyId: P,
      reservationRoomId: RR,
    });
    expect(tags).toContainEqual({ type: "Folio", id: "LEDGER-folio-2" });
    // Failed command: still refreshes the account (the server state is authoritative).
    const failed = afterFinancial(
      undefined,
      { status: 409 },
      { propertyId: P, reservationRoomId: RR },
    );
    expect(failed).toContainEqual({ type: "Folio", id: RR });
  });

  it("never invalidates whole financial tag types", () => {
    const source = readFileSync("lib/api/endpoints/billing.api.ts", "utf8");
    expect(source).not.toMatch(/invalidatesTags:\s*\[\s*"(Folio|Payment|Stay)"/);
    expect(source).not.toContain("FINANCIAL");
  });

  it("leaves availability alone for cleaning-only commands", () => {
    expect(operationsTags(P)).toContainEqual({ type: "Availability", id: P });
    const cleaning = operationsTags(P, { availability: false });
    expect(cleaning.map((tag) => tag.type)).not.toContain("Availability");
    expect(cleaning).toContainEqual({ type: "RoomStatus", id: `BOARD-${P}` });
  });
});
