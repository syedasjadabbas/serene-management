import { afterEach, describe, expect, it } from "vitest";
import { initials } from "@/components/ui/Avatar";
import { anchoredPopoverStyle, highlightRanges } from "@/components/ui/listbox";
import { navMenuSide } from "@/components/workspace/NavMenu";
import { toClientApiError } from "@/lib/api/errors";
import { randomId } from "@/lib/utils/random-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId (client Idempotency-Keys)", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
  afterEach(() => {
    if (original) Object.defineProperty(globalThis.crypto, "randomUUID", original);
  });

  it("uses crypto.randomUUID in a secure context", () => {
    expect(randomId()).toMatch(UUID_V4);
  });

  it("still yields a v4 UUID where randomUUID is missing (plain-HTTP origin)", () => {
    // Browsers omit randomUUID outside secure contexts; getRandomValues remains.
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    expect(typeof globalThis.crypto.randomUUID).toBe("undefined");
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});

describe("initials", () => {
  it("keeps the documented cases", () => {
    expect(initials("Syed Asjad Abbas")).toBe("SA");
    expect(initials("Farooq, Daniyal")).toBe("FD");
    expect(initials("Nadia")).toBe("N");
    expect(initials("")).toBe("?");
  });

  it("ignores a parenthesised note (QA report: avatar read “I(”)", () => {
    expect(initials("Imran Ali (Housekeeping)")).toBe("IA");
    expect(initials("Ayesha Khan (GM, Mountain Resort)")).toBe("AK");
    expect(initials("Tariq Aziz (Chief Engineer)")).toBe("TA");
    expect(initials("(Front Desk)")).toBe("FD");
  });
});

describe("anchoredPopoverStyle (shared dropdown positioning)", () => {
  const viewport = { width: 1280, height: 900 };

  it("opens below the trigger with every offset explicit", () => {
    const style = anchoredPopoverStyle({ left: 32, top: 100, bottom: 138, width: 240 }, viewport);
    expect(style).toMatchObject({
      position: "fixed",
      left: 32,
      top: 142,
      bottom: "auto",
      right: "auto",
    });
    expect(style).not.toHaveProperty("inset");
  });

  it("opens above near the bottom edge, still without the inset shorthand", () => {
    const style = anchoredPopoverStyle({ left: 32, top: 690, bottom: 728, width: 240 }, viewport);
    expect(style).toMatchObject({ left: 32, top: "auto", bottom: 900 - 690 + 4, right: "auto" });
    expect(style).not.toHaveProperty("inset");
  });

  it("stays inside a narrow viewport", () => {
    const style = anchoredPopoverStyle(
      { left: 300, top: 100, bottom: 138, width: 120 },
      { width: 375, height: 812 },
    );
    expect(Number(style.left) + Number(style.width)).toBeLessThanOrEqual(375 - 8);
  });
});

describe("navMenuSide (header menus, QA report 2: Rooms menu cut off on the left)", () => {
  it("opens rightwards from a button near the left edge, even when it is the last item", () => {
    // hk.smr / maint.smr see "Dashboard · Rooms": Rooms is last but at x≈190.
    expect(navMenuSide({ left: 188, right: 318 }, 320, 1440)).toBe("left");
  });

  it("opens leftwards only when the panel would run past the right edge", () => {
    expect(navMenuSide({ left: 1150, right: 1240 }, 320, 1280)).toBe("right");
  });

  it("never picks a side that leaves the screen when the other one fits", () => {
    for (const vw of [1024, 1280, 1440, 1920]) {
      for (let left = 16; left + 90 <= vw - 16; left += 37) {
        const anchor = { left, right: left + 90 };
        const side = navMenuSide(anchor, 320, vw);
        const panelLeft = side === "left" ? anchor.left : anchor.right - 320;
        expect(panelLeft).toBeGreaterThanOrEqual(0);
        expect(panelLeft + 320).toBeLessThanOrEqual(vw);
      }
    }
  });
});

describe("highlightRanges (guest search highlighting)", () => {
  it("marks the whole query when it occurs", () => {
    expect(highlightRanges("Mr Ahmed Al Mansoori", "ahmed")).toEqual([[3, 8]]);
  });

  it("marks every word of a multi-word query in any order", () => {
    expect(highlightRanges("Mr Ahmed Al Mansoori", "Mansoori Ahmed")).toEqual([
      [3, 8],
      [12, 20],
    ]);
  });

  it("merges overlapping words and ignores blanks", () => {
    expect(highlightRanges("Annabelle", "ann anna")).toEqual([[0, 4]]);
    expect(highlightRanges("Nadia", "   ")).toEqual([]);
    expect(highlightRanges("Nadia", "zz")).toEqual([]);
  });
});

describe("toClientApiError (QA report 2: 'Take & start' said 'Cannot reach the server')", () => {
  it("reports a non-JSON reply (HTML 404 page) as an unexpected server response, not a network failure", () => {
    const e = toClientApiError({
      status: "PARSING_ERROR",
      originalStatus: 404,
      data: "<!DOCTYPE html>",
      error: "SyntaxError",
    });
    expect(e?.status).toBe(404);
    expect(e?.code).toBe("INTERNAL_ERROR");
    expect(e?.message).toContain("HTTP 404");
    expect(e?.message).not.toMatch(/cannot reach/i);
  });

  it("keeps 'Cannot reach the server' for genuine connection failures only", () => {
    expect(
      toClientApiError({ status: "FETCH_ERROR", error: "TypeError: Failed to fetch" })?.message,
    ).toMatch(/cannot reach the server/i);
    expect(toClientApiError({ status: "TIMEOUT_ERROR", error: "timeout" })?.message).toMatch(
      /too long/i,
    );
    expect(
      toClientApiError({ name: "TypeError", message: "x is not a function" })?.message,
    ).toMatch(/went wrong on this page/i);
  });

  it("still uses the API envelope for JSON errors", () => {
    const e = toClientApiError({
      status: 404,
      data: {
        error: { code: "NOT_FOUND", message: "Housekeeping task not found", requestId: "r1" },
      },
    });
    expect(e).toMatchObject({
      code: "NOT_FOUND",
      message: "Housekeeping task not found",
      status: 404,
    });
  });
});
