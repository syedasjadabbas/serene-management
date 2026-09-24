import { describe, expect, it } from "vitest";
import {
  applyPercent,
  average,
  formatMoney,
  parseMoney,
  roundToIncrement,
  roundToMinorUnits,
  sum,
} from "@/lib/utils/money";

describe("exact decimal money", () => {
  it("parses and formats without floating-point drift", () => {
    expect(formatMoney(parseMoney("0.1") + parseMoney("0.2"))).toBe("0.3000");
    expect(formatMoney(parseMoney("-12.5"))).toBe("-12.5000");
    expect(formatMoney(parseMoney("18500"), 2)).toBe("18500.00");
    expect(() => parseMoney("1.23456")).toThrow();
    expect(() => parseMoney("abc")).toThrow();
  });

  it("rounds half away from zero to currency minor units", () => {
    expect(formatMoney(roundToMinorUnits(parseMoney("10.005"), 2))).toBe("10.0100");
    expect(formatMoney(roundToMinorUnits(parseMoney("-10.005"), 2))).toBe("-10.0100");
    expect(formatMoney(roundToMinorUnits(parseMoney("10.0049"), 2))).toBe("10.0000");
    expect(formatMoney(roundToMinorUnits(parseMoney("1.2345"), 3))).toBe("1.2350");
  });

  it("applies percentages and increments exactly", () => {
    expect(formatMoney(applyPercent(parseMoney("18500"), parseMoney("-10")))).toBe("16650.0000");
    expect(formatMoney(applyPercent(parseMoney("99.99"), parseMoney("15")))).toBe("114.9885");
    expect(formatMoney(roundToIncrement(parseMoney("16651.40"), parseMoney("1")))).toBe(
      "16651.0000",
    );
    expect(formatMoney(roundToIncrement(parseMoney("16651.50"), parseMoney("5")))).toBe(
      "16650.0000",
    );
  });

  it("sums and averages", () => {
    const values = ["16000", "16000", "19500"].map(parseMoney);
    expect(formatMoney(sum(values), 2)).toBe("51500.00");
    expect(formatMoney(average(values, 2), 2)).toBe("17166.67");
  });
});
