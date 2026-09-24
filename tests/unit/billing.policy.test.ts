import { describe, expect, it } from "vitest";
import { formatMoney, isMinorUnitAligned, minorUnitStep, parseMoney } from "@/lib/utils/money";
import {
  type PackageComponentInput,
  type TaxRuleInput,
  calculateCharge,
  packageLinesForNight,
  paymentProblem,
  proportionalCredit,
  refundProblem,
  reversalProblem,
  roomLineAmount,
  roomPostingKey,
  rulesInForce,
  settleProblem,
} from "@/modules/billing/billing.policy";
import {
  adjustSchema,
  chargeSchema,
  paymentSchema,
  positiveAmountSchema,
} from "@/modules/billing/billing.schema";

const m = parseMoney;
const f = (units: bigint) => formatMoney(units, 2);

function tax(
  code: string,
  rate: string,
  sequence: number,
  overrides: Partial<TaxRuleInput> = {},
): TaxRuleInput {
  return {
    id: code,
    code,
    name: code,
    calculation: "PERCENT",
    basis: "NET",
    rate: m(rate),
    sequence,
    transactionCodeId: `tx-${code}`,
    ...overrides,
  };
}

const GST = tax("GST", "16", 1);
const SVC = tax("SVC", "10", 1);
const MUNI = tax("MUNI", "7", 2);
const VAT = tax("VAT", "5", 3, { basis: "COMPOUND" });
const TDIR = tax("TDIR", "15", 4, { calculation: "FLAT_PER_UNIT" });

function charge(amount: string, rules: TaxRuleInput[], inclusive = false, quantity = 1) {
  const result = calculateCharge({ amount: m(amount), quantity, inclusive, rules, minorUnits: 2 });
  return {
    net: f(result.net),
    taxes: result.taxes.map((t) => [t.rule.code, f(t.amount)]),
    total: f(result.total),
  };
}

describe("money precision", () => {
  it("aligns amounts to the currency minor unit", () => {
    expect(minorUnitStep(2)).toBe(100n);
    expect(minorUnitStep(3)).toBe(10n);
    expect(isMinorUnitAligned(m("12.34"), 2)).toBe(true);
    expect(isMinorUnitAligned(m("12.345"), 2)).toBe(false);
    expect(isMinorUnitAligned(m("12.345"), 3)).toBe(true);
  });
});

describe("tax calculation (line level, half away from zero)", () => {
  it("adds a percentage tax on the net amount", () => {
    expect(charge("1000.00", [GST])).toEqual({
      net: "1000.00",
      taxes: [["GST", "160.00"]],
      total: "1160.00",
    });
  });

  it("rounds each tax once to the minor unit", () => {
    // 333.33 × 16% = 53.3328 → 53.33
    expect(charge("333.33", [GST]).taxes).toEqual([["GST", "53.33"]]);
    // 0.10 × 5% = 0.005 → 0.01 (half away from zero)
    expect(charge("0.10", [tax("V", "5", 1)]).taxes).toEqual([["V", "0.01"]]);
    // 0.09 × 5% = 0.0045 → 0.00
    expect(charge("0.09", [tax("V", "5", 1)]).taxes).toEqual([["V", "0.00"]]);
  });

  it("applies several components in sequence, compound on earlier taxes", () => {
    // SVC 10% + MUNI 7% on 1000, VAT 5% on 1170, flat 15 per unit.
    expect(charge("1000.00", [VAT, TDIR, MUNI, SVC])).toEqual({
      net: "1000.00",
      taxes: [
        ["SVC", "100.00"],
        ["MUNI", "70.00"],
        ["VAT", "58.50"],
        ["TDIR", "15.00"],
      ],
      total: "1243.50",
    });
    expect(charge("200.00", [TDIR], false, 3).taxes).toEqual([["TDIR", "45.00"]]);
  });

  it("handles zero tax and zero amounts", () => {
    expect(charge("250.00", [])).toEqual({ net: "250.00", taxes: [], total: "250.00" });
    expect(charge("0.00", [GST]).total).toBe("0.00");
  });

  it("splits a tax-inclusive amount so net + taxes equal it exactly", () => {
    expect(charge("1160.00", [GST], true)).toEqual({
      net: "1000.00",
      taxes: [["GST", "160.00"]],
      total: "1160.00",
    });
    // 100 / 1.16 = 86.2069 → tax 13.79, net absorbs the residual.
    expect(charge("100.00", [GST], true)).toEqual({
      net: "86.21",
      taxes: [["GST", "13.79"]],
      total: "100.00",
    });
    expect(charge("1243.50", [SVC, MUNI, VAT, TDIR], true)).toEqual({
      net: "1000.00",
      taxes: [
        ["SVC", "100.00"],
        ["MUNI", "70.00"],
        ["VAT", "58.50"],
        ["TDIR", "15.00"],
      ],
      total: "1243.50",
    });
    for (const gross of ["0.01", "0.99", "17.03", "99999.99"]) {
      const result = calculateCharge({
        amount: m(gross),
        quantity: 1,
        inclusive: true,
        rules: [SVC, MUNI, VAT],
        minorUnits: 2,
      });
      expect(result.net + result.taxes.reduce((s, t) => s + t.amount, 0n)).toBe(m(gross));
      expect(result.net >= 0n).toBe(true);
    }
  });

  it("refuses amounts finer than the currency or negative", () => {
    expect(() => charge("10.001", [GST])).toThrow(/minor units/);
    expect(() => charge("-1.00", [GST])).toThrow(/negative/);
    expect(() =>
      calculateCharge({ amount: m("1"), quantity: 0, inclusive: false, rules: [], minorUnits: 2 }),
    ).toThrow(/Quantity/);
  });

  it("selects rules in force on the business date", () => {
    const rules = [
      { code: "OLD", effectiveFrom: "2025-01-01", effectiveTo: "2026-06-30" },
      { code: "NEW", effectiveFrom: "2026-07-01", effectiveTo: null },
    ];
    expect(rulesInForce(rules, "2026-06-30").map((r) => r.code)).toEqual(["OLD"]);
    expect(rulesInForce(rules, "2026-09-24").map((r) => r.code)).toEqual(["NEW"]);
  });
});

describe("proportional credit (adjustments)", () => {
  const lines = [
    { id: "charge", remaining: m("1000.00") },
    { id: "tax", remaining: m("160.00") },
  ];

  it("splits a credit across charge and taxes", () => {
    expect(proportionalCredit(lines, m("580.00"), 2)).toEqual([
      { id: "charge", amount: m("500.00") },
      { id: "tax", amount: m("80.00") },
    ]);
  });

  it("credits exactly what remains when the whole line is adjusted", () => {
    expect(proportionalCredit(lines, m("1160.00"), 2)).toEqual([
      { id: "charge", amount: m("1000.00") },
      { id: "tax", amount: m("160.00") },
    ]);
  });

  it("absorbs rounding residuals without exceeding any line", () => {
    const tiny = [
      { id: "charge", remaining: m("0.05") },
      { id: "tax", remaining: m("0.01") },
    ];
    const parts = proportionalCredit(tiny, m("0.03"), 2);
    expect(parts.reduce((s, p) => s + p.amount, 0n)).toBe(m("0.03"));
    parts.forEach((p, i) => expect(p.amount <= tiny[i]!.remaining).toBe(true));
    for (const amount of ["0.01", "0.37", "333.33", "1159.99"]) {
      const split = proportionalCredit(lines, m(amount), 2);
      expect(split.reduce((s, p) => s + p.amount, 0n)).toBe(m(amount));
      split.forEach((p, i) => expect(p.amount <= lines[i]!.remaining && p.amount >= 0n).toBe(true));
    }
  });

  it("rejects credits above the remaining total", () => {
    expect(() => proportionalCredit(lines, m("1160.01"), 2)).toThrow();
    expect(() => proportionalCredit(lines, 0n, 2)).toThrow();
  });
});

describe("packages", () => {
  const breakfast: PackageComponentInput = {
    componentId: "bf",
    name: "Breakfast",
    transactionCodeId: "tx-bf",
    postingType: "INCLUDED_IN_RATE",
    calculation: "PER_PERSON",
    rhythm: "EVERY_NIGHT",
    daysOfWeek: 127,
    unitPrice: m("1500.00"),
    packageQuantity: 1,
    isAllowance: false,
  };
  const stay = { arrival: "2026-09-20", departure: "2026-09-23", adults: 2, children: 1 };

  it("prices components per person and posting rhythm", () => {
    const lines = packageLinesForNight([breakfast], { ...stay, night: "2026-09-21" });
    expect(lines).toMatchObject([{ componentId: "bf", quantity: 3, amount: m("4500.00") }]);
    const arrivalOnly = { ...breakfast, rhythm: "ARRIVAL_NIGHT" as const };
    expect(packageLinesForNight([arrivalOnly], { ...stay, night: "2026-09-21" })).toEqual([]);
    expect(packageLinesForNight([arrivalOnly], { ...stay, night: "2026-09-20" })).toHaveLength(1);
    const last = { ...breakfast, rhythm: "LAST_NIGHT" as const, calculation: "PER_ADULT" as const };
    expect(packageLinesForNight([last], { ...stay, night: "2026-09-22" })).toMatchObject([
      { quantity: 2 },
    ]);
    // Weekdays: 2026-09-21 is a Monday (bit 1).
    const mondays = { ...breakfast, rhythm: "WEEKDAYS" as const, daysOfWeek: 1 };
    expect(packageLinesForNight([mondays], { ...stay, night: "2026-09-21" })).toHaveLength(1);
    expect(packageLinesForNight([mondays], { ...stay, night: "2026-09-22" })).toHaveLength(0);
    const allowance = { ...breakfast, isAllowance: true };
    expect(packageLinesForNight([allowance], { ...stay, night: "2026-09-21" })).toEqual([]);
  });

  it("carves included components out of the rate and adds combined ones", () => {
    const lines = packageLinesForNight([breakfast], { ...stay, night: "2026-09-21" });
    expect(roomLineAmount(m("20000.00"), lines)).toBe(m("15500.00"));
    const combined = packageLinesForNight([{ ...breakfast, postingType: "COMBINED_WITH_ROOM" }], {
      ...stay,
      night: "2026-09-21",
    });
    expect(roomLineAmount(m("20000.00"), combined)).toBe(m("24500.00"));
    expect(() => roomLineAmount(m("1000.00"), lines)).toThrow(/exceed/);
  });

  it("uses deterministic posting keys per night and generation", () => {
    expect(roomPostingKey("rr", "2026-09-21", 1)).toBe("ROOM:rr:2026-09-21:1");
    expect(roomPostingKey("rr", "2026-09-21", 2)).not.toBe(roomPostingKey("rr", "2026-09-21", 1));
  });
});

describe("payment, refund, settlement and reversal rules", () => {
  it("never lets a payment exceed the balance", () => {
    expect(paymentProblem(m("100"), m("100"))).toBeNull();
    expect(paymentProblem(m("40"), m("100"))).toBeNull();
    expect(paymentProblem(m("100.01"), m("100"))).toMatch(/more than the balance/);
    expect(paymentProblem(m("10"), 0n)).toMatch(/no balance/);
    expect(paymentProblem(0n, m("100"))).toMatch(/greater than zero/);
  });

  it("limits refunds to what remains refundable on a captured payment", () => {
    const payment = { status: "CAPTURED", amount: m("500"), refunded: m("200") };
    expect(refundProblem(m("300"), payment)).toBeNull();
    expect(refundProblem(m("300.01"), payment)).toMatch(/more than what remains/);
    expect(refundProblem(m("1"), { ...payment, status: "VOIDED" })).toMatch(/captured/);
  });

  it("settles only an open zero-balance window", () => {
    expect(settleProblem("OPEN", 0n)).toBeNull();
    expect(settleProblem("OPEN", m("0.01"))).toMatch(/zero balance/);
    expect(settleProblem("SETTLED", 0n)).toMatch(/already settled/);
    expect(settleProblem("CLOSED", 0n)).toMatch(/closed/);
  });

  it("reverses only unreversed, unadjusted charges of the business date", () => {
    const item = { kind: "CHARGE", businessDate: "2026-09-24", reversed: false, adjusted: false };
    expect(reversalProblem(item, "2026-09-24")).toBeNull();
    expect(reversalProblem({ ...item, businessDate: "2026-09-23" }, "2026-09-24")).toMatch(
      /adjust earlier/,
    );
    expect(reversalProblem({ ...item, reversed: true }, "2026-09-24")).toMatch(/already/);
    expect(reversalProblem({ ...item, adjusted: true }, "2026-09-24")).toMatch(/adjusted/);
    expect(reversalProblem({ ...item, kind: "TAX" }, "2026-09-24")).toMatch(/Only charges/);
  });
});

describe("contracts never accept client-side money authority", () => {
  const id = "01900000-0000-7000-8000-000000000001";

  it("rejects totals, taxes, balances and business dates in requests", () => {
    const base = { transactionCodeId: id, quantity: 2, unitAmount: "150.00" };
    expect(chargeSchema.safeParse(base).success).toBe(true);
    for (const extra of [{ total: "300" }, { tax: "48" }, { businessDate: "2026-01-01" }]) {
      expect(chargeSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    const payment = { methodId: id, amount: "100.00", version: 3 };
    expect(paymentSchema.safeParse(payment).success).toBe(true);
    expect(paymentSchema.safeParse({ ...payment, balance: "0" }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...payment, version: undefined }).success).toBe(false);
    expect(adjustSchema.safeParse({ amount: "5", reasonCodeId: id }).success).toBe(false);
  });

  it("accepts only positive decimal amounts", () => {
    for (const ok of ["1", "0.01", "1250.00", "9999999999999.9999"]) {
      expect(positiveAmountSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["0", "0.00", "-5", "1e3", "1.23456", "", "12,50"]) {
      expect(positiveAmountSchema.safeParse(bad).success).toBe(false);
    }
  });
});
