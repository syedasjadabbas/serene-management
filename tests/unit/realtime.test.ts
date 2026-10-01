import { describe, expect, it } from "vitest";
import { parseEventBlock } from "@/lib/realtime/client";
import { parseNotification } from "@/lib/realtime/hub";
import { TOPIC_REFETCH_GAP_MS, topicsFor } from "@/lib/realtime/topics";
import {
  advancePropertyTime,
  msUntilAfterLocalMidnight,
} from "@/modules/business-date/business-date.policy";

const P = "01890a5d-ac96-774b-bcce-b302099a8057";

describe("live update topics", () => {
  it("follows the read permission each screen needs; the business date needs property access only", () => {
    expect(topicsFor(() => true)).toEqual(["frontdesk", "rooms", "housekeeping", "businessdate"]);
    expect(topicsFor(() => false)).toEqual(["businessdate"]);
    expect(topicsFor((p) => p === "housekeeping:read")).toEqual(["housekeeping", "businessdate"]);
  });

  it("never refetches heavy screens more often than the former 60 s polling", () => {
    expect(TOPIC_REFETCH_GAP_MS.frontdesk).toBeGreaterThanOrEqual(60_000);
    expect(TOPIC_REFETCH_GAP_MS.rooms).toBeGreaterThanOrEqual(60_000);
  });
});

describe("notification parsing (hub)", () => {
  it("reads a change: property, known topics, transaction id", () => {
    expect(
      parseNotification("serene_changes", JSON.stringify({ p: P, t: "frontdesk,rooms", x: "42" })),
    ).toEqual({ kind: "change", propertyId: P, topics: ["frontdesk", "rooms"], tx: "42" });
  });

  it("drops unknown topics and malformed payloads", () => {
    expect(
      parseNotification("serene_changes", JSON.stringify({ p: P, t: "billing,rooms", x: "1" })),
    ).toMatchObject({ topics: ["rooms"] });
    for (const payload of [
      "not json",
      JSON.stringify({ p: "x", t: "rooms", x: "1" }),
      JSON.stringify({ p: P, t: "billing", x: "1" }),
      JSON.stringify({ p: P, t: "rooms", x: "1; drop" }),
      "null",
    ]) {
      expect(parseNotification("serene_changes", payload)).toBeNull();
    }
    expect(
      parseNotification("other_channel", JSON.stringify({ p: P, t: "rooms", x: "1" })),
    ).toBeNull();
  });

  it("reads access changes by session, user, organization, property or all", () => {
    expect(parseNotification("serene_access", JSON.stringify({ s: P }))).toMatchObject({
      kind: "access",
      sessionId: P,
    });
    expect(parseNotification("serene_access", JSON.stringify({ all: true }))).toMatchObject({
      all: true,
    });
    expect(parseNotification("serene_access", JSON.stringify({ u: "nope" }))).toBeNull();
  });
});

describe("server-sent event parsing (client)", () => {
  it("reads the event name and data, ignoring comments", () => {
    expect(parseEventBlock('event: change\ndata: {"t":["rooms"],"x":"7"}')).toEqual({
      event: "change",
      data: '{"t":["rooms"],"x":"7"}',
    });
    expect(parseEventBlock(": ping")).toBeNull();
    expect(parseEventBlock("retry: 5000")).toBeNull();
    expect(parseEventBlock("data: a\ndata: b")).toEqual({ event: "message", data: "a\nb" });
  });
});

describe("property clock", () => {
  it("advances the server's local time by whole elapsed minutes, across midnight", () => {
    expect(advancePropertyTime("2026-09-29", "23:58", 59_000)).toEqual({
      date: "2026-09-29",
      time: "23:58",
    });
    expect(advancePropertyTime("2026-09-29", "23:58", 3 * 60_000)).toEqual({
      date: "2026-09-30",
      time: "00:01",
    });
    expect(advancePropertyTime("2026-12-31", "10:00", 26 * 3_600_000)).toEqual({
      date: "2027-01-01",
      time: "12:00",
    });
  });

  it("schedules the rollover refetch after midnight, never before it", () => {
    // 23:59 read now: midnight is at most 60 s away, the refetch comes 5 s after.
    expect(msUntilAfterLocalMidnight("23:59", 0)).toBe(65_000);
    expect(msUntilAfterLocalMidnight("00:00", 0)).toBe(24 * 3_600_000 + 5_000);
    expect(msUntilAfterLocalMidnight("23:59", 120_000)).toBe(5_000);
  });
});
