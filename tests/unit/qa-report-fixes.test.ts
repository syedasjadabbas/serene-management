import { afterEach, describe, expect, it } from "vitest";
import { initials } from "@/components/ui/Avatar";
import { anchoredPopoverStyle } from "@/components/ui/listbox";
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
