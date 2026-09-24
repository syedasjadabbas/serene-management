import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDateSync,
  daysBetween,
  isAcceptableInitialBusinessDate,
  isDateOnly,
  isValidTimeZone,
  localDateInZone,
  localTimeInZone,
} from "@/modules/business-date/business-date.policy";

describe("property time zones", () => {
  // 2026-09-24T20:30Z is already the 25th in Karachi (UTC+5) and Auckland (UTC+12),
  // still the 24th in Dubai (UTC+4) and Los Angeles (UTC-7).
  const instant = new Date("2026-09-24T20:30:00.000Z");

  it("computes the calendar date at the property, not on the server", () => {
    expect(localDateInZone(instant, "Asia/Karachi")).toBe("2026-09-25");
    expect(localDateInZone(instant, "Pacific/Auckland")).toBe("2026-09-25");
    expect(localDateInZone(instant, "Asia/Dubai")).toBe("2026-09-25");
    expect(localDateInZone(instant, "America/Los_Angeles")).toBe("2026-09-24");
    expect(localDateInZone(new Date("2026-09-24T19:59:00.000Z"), "Asia/Dubai")).toBe("2026-09-24");
  });

  it("computes local wall-clock time in 24h format", () => {
    expect(localTimeInZone(instant, "Asia/Karachi")).toBe("01:30");
    expect(localTimeInZone(instant, "America/Los_Angeles")).toBe("13:30");
    expect(localTimeInZone(new Date("2026-09-24T19:00:00.000Z"), "Asia/Karachi")).toBe("00:00");
  });

  it("handles daylight-saving transitions", () => {
    // US DST ends 2026-11-01 at 02:00 local (09:00Z): 08:30Z is 01:30 PDT, 09:30Z is 01:30 PST.
    expect(localTimeInZone(new Date("2026-11-01T08:30:00.000Z"), "America/Los_Angeles")).toBe(
      "01:30",
    );
    expect(localTimeInZone(new Date("2026-11-01T09:30:00.000Z"), "America/Los_Angeles")).toBe(
      "01:30",
    );
    expect(localDateInZone(new Date("2026-11-01T09:30:00.000Z"), "America/Los_Angeles")).toBe(
      "2026-11-01",
    );
  });

  it("validates IANA zone names", () => {
    expect(isValidTimeZone("Asia/Karachi")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("date-only arithmetic", () => {
  it("validates and shifts calendar dates without time-zone drift", () => {
    expect(isDateOnly("2026-02-29")).toBe(false);
    expect(isDateOnly("2028-02-29")).toBe(true);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-24", "2026-09-27")).toBe(3);
  });
});

describe("business date vs property calendar", () => {
  it("classifies the lag", () => {
    expect(businessDateSync("2026-09-24", "2026-09-24")).toEqual({ lagDays: 0, state: "IN_SYNC" });
    expect(businessDateSync("2026-09-24", "2026-09-25")).toEqual({
      lagDays: 1,
      state: "AWAITING_AUDIT",
    });
    expect(businessDateSync("2026-09-24", "2026-09-27")).toEqual({
      lagDays: 3,
      state: "AUDIT_OVERDUE",
    });
    expect(businessDateSync("2026-09-25", "2026-09-24")).toEqual({ lagDays: -1, state: "AHEAD" });
  });

  it("accepts go-live on the local date or the day before only", () => {
    expect(isAcceptableInitialBusinessDate("2026-09-25", "2026-09-25")).toBe(true);
    expect(isAcceptableInitialBusinessDate("2026-09-24", "2026-09-25")).toBe(true);
    expect(isAcceptableInitialBusinessDate("2026-09-23", "2026-09-25")).toBe(false);
    expect(isAcceptableInitialBusinessDate("2026-09-26", "2026-09-25")).toBe(false);
  });
});
