import { describe, expect, it } from "vitest";
import { csvField, toCsv } from "@/lib/utils/csv";
import { parseMoney } from "@/lib/utils/money";
import {
  CHECK_STEPS,
  COMMIT_STEPS,
  closeDateProblem,
  isBlocking,
  isStaleRun,
  stepStatusOf,
} from "@/modules/night-audit/night-audit.policy";
import {
  adr,
  availableRooms,
  occupancy,
  payingRooms,
  percent,
  perRoom,
  revpar,
} from "@/modules/reports/reports.policy";

const facts = { physical: 100, outOfOrder: 4, sold: 72, complimentary: 2, houseUse: 1 };

describe("hotel KPIs", () => {
  it("counts available and paying rooms", () => {
    expect(availableRooms(facts)).toBe(96);
    expect(payingRooms(facts)).toBe(69);
    expect(availableRooms({ ...facts, outOfOrder: 150 })).toBe(0);
  });

  it("computes occupancy with two decimals, half away from zero", () => {
    expect(occupancy(facts)).toBe("75.00");
    expect(percent(1, 3)).toBe("33.33");
    expect(percent(2, 3)).toBe("66.67");
    expect(percent(0, 0)).toBe("0.00");
  });

  it("computes ADR over paying rooms and RevPAR over available rooms, exactly", () => {
    const revenue = parseMoney("690000.00");
    expect(adr(facts, revenue)).toBe("10000.0000");
    expect(revpar(facts, revenue)).toBe("7187.5000");
    expect(perRoom(parseMoney("100.00"), 3)).toBe("33.3333");
    expect(perRoom(parseMoney("100.00"), 0)).toBe("0.0000");
    expect(adr({ ...facts, sold: 3, complimentary: 3, houseUse: 0 }, revenue)).toBe("0.0000");
  });
});

describe("night audit policy", () => {
  it("never closes a date ahead of the hotel's calendar", () => {
    expect(closeDateProblem("2026-09-25", "2026-09-25")).toBeNull();
    expect(closeDateProblem("2026-09-24", "2026-09-25")).toBeNull();
    expect(closeDateProblem("2026-09-26", "2026-09-25")).toMatch(/ahead/);
  });

  it("classifies checks and orders the steps", () => {
    expect(stepStatusOf("BLOCKING")).toBe("FAILED");
    expect(stepStatusOf("WARNING")).toBe("SUCCEEDED");
    expect(stepStatusOf("SKIPPED")).toBe("SKIPPED");
    expect(isBlocking([{ outcome: "WARNING" }, { outcome: "PASSED" }])).toBe(false);
    expect(isBlocking([{ outcome: "WARNING" }, { outcome: "BLOCKING" }])).toBe(true);
    expect(CHECK_STEPS).toHaveLength(7);
    expect(COMMIT_STEPS.at(-1)).toBe("CLOSE_DATE");
    expect(COMMIT_STEPS.indexOf("STATISTICS")).toBeLessThan(COMMIT_STEPS.indexOf("CLOSE_DATE"));
  });

  it("treats a run as stale only after the threshold", () => {
    const started = new Date("2026-09-25T20:00:00Z");
    expect(isStaleRun(started, new Date("2026-09-25T20:01:00Z"))).toBe(false);
    expect(isStaleRun(started, new Date("2026-09-25T20:05:00Z"))).toBe(true);
  });
});

describe("CSV", () => {
  it("quotes separators and neutralizes formulas", () => {
    expect(csvField('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvField("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(csvField("-120.50")).toBe("-120.50");
    expect(csvField(null)).toBe("");
    expect(toCsv(["a", "b"], [["1", "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
