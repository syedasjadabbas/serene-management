import { describe, expect, it } from "vitest";
import {
  emptyPackageComponent,
  packageDefaults,
  packageFormSchema,
  packagePayload,
} from "@/app/(workspace)/[propertyCode]/rates/_lib/packageForm";
import {
  ratePlanDefaults,
  ratePlanFormSchema,
  ratePlanPayloadFields,
} from "@/app/(workspace)/[propertyCode]/rates/_lib/ratePlanForm";
import {
  restrictionDefaults,
  restrictionFormSchema,
  restrictionPayload,
} from "@/app/(workspace)/[propertyCode]/rates/_lib/restrictionForm";
import {
  seasonAmounts,
  seasonFormSchema,
} from "@/app/(workspace)/[propertyCode]/rates/[ratePlanId]/_lib/planDialogForms";
import {
  addRoomsFormSchema,
  floorFormSchema,
  goLiveFormSchema,
  roomTypeFields,
  roomTypeFormSchema,
  settingsChanges,
  settingsDefaults,
  taxFormSchema,
  taxFields,
  trimRate,
} from "@/app/(workspace)/[propertyCode]/setup/_lib/setupForm";
import { parseRoomNumbers } from "@/app/(workspace)/[propertyCode]/setup/_components/SetupFields";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe("rate plan form", () => {
  const base = {
    ...ratePlanDefaults(),
    name: "Corporate",
    roomTransactionCodeId: "rc1",
    parentId: "p1",
    roomTypeIds: ["rt1"],
    code: "CORP",
    reason: "new plan",
  };

  it("defaults to a derived corporate plan with -10 percent", () => {
    const d = ratePlanDefaults();
    expect(d).toMatchObject({
      kind: "CORPORATE",
      derived: true,
      derivationValue: "-10",
      rounding: "1",
    });
  });

  it("accepts a complete create form and requires the code only on create", () => {
    expect(ratePlanFormSchema(false).safeParse(base).success).toBe(true);
    const noCode = { ...base, code: "" };
    expect(messages(ratePlanFormSchema(false).safeParse(noCode))).toContain("Enter a code");
    expect(ratePlanFormSchema(true).safeParse(noCode).success).toBe(true);
  });

  it("reports every missing rule", () => {
    const result = ratePlanFormSchema(false).safeParse({ ...ratePlanDefaults(), derived: true });
    expect(messages(result)).toEqual(
      expect.arrayContaining([
        "Enter a name",
        "Enter a code",
        "Select the room revenue code",
        "Select at least one room type",
        "Select the parent plan",
        "Enter a reason of at least 3 characters",
      ]),
    );
  });

  it("builds the payload: trims, nulls blanks, forces negotiation for NEGOTIATED", () => {
    const fields = ratePlanPayloadFields(
      { ...base, name: " Corp ", kind: "NEGOTIATED", derivationValue: " -5 ", rounding: " " },
      undefined,
    );
    expect(fields).toMatchObject({
      name: "Corp",
      requiresNegotiation: true,
      displayOrder: 10,
      stayFrom: null,
      description: null,
      derivation: { parentRatePlanId: "p1", value: "-5", roundingIncrement: null },
    });
    expect(ratePlanPayloadFields({ ...base, derived: false }, 3).derivation).toBeNull();
  });
});

describe("restriction form", () => {
  it("defaults to every weekday and the start date", () => {
    expect(restrictionDefaults("2027-01-01")).toMatchObject({
      action: "set",
      from: "2027-01-01",
      to: "2027-01-01",
      daysOfWeek: 127,
    });
  });

  it("needs dates, a weekday and a reason", () => {
    const result = restrictionFormSchema.safeParse({
      ...restrictionDefaults(""),
      daysOfWeek: 0,
    });
    expect(messages(result)).toEqual(
      expect.arrayContaining([
        "Select the first date",
        "Select the last date",
        "Select at least one weekday",
        "Enter a reason of at least 3 characters",
      ]),
    );
  });

  it("sends the value only when setting a valued restriction", () => {
    const v = { ...restrictionDefaults("2027-01-01"), reason: " why " };
    expect(restrictionPayload({ ...v, type: "MIN_LOS" }).value).toBe(2);
    expect(restrictionPayload({ ...v, type: "CLOSED" }).value).toBeNull();
    expect(restrictionPayload({ ...v, type: "MIN_LOS", action: "clear" }).value).toBeNull();
    expect(restrictionPayload(v).reason).toBe("why");
  });
});

describe("package form", () => {
  it("starts with one empty component", () => {
    expect(packageDefaults().components).toEqual([emptyPackageComponent()]);
  });

  it("validates components and keeps prices as decimal strings", () => {
    const schema = packageFormSchema(false);
    const ok = {
      ...packageDefaults(),
      code: "BB",
      name: "Breakfast",
      components: [
        { ...emptyPackageComponent(), name: "Buffet", transactionCodeId: "t1", unitPrice: "12.50" },
      ],
    };
    expect(schema.safeParse(ok).success).toBe(true);
    const bad = schema.safeParse({
      ...ok,
      components: [{ ...ok.components[0]!, unitPrice: "12,5" }],
    });
    expect(bad.success).toBe(false);
    expect(packagePayload(ok, false)).toMatchObject({
      code: "BB",
      components: [{ unitPrice: "12.50", daysOfWeek: 127 }],
    });
    expect(packagePayload(ok, true)).toMatchObject({ status: "ACTIVE" });
  });
});

describe("season form", () => {
  it("needs at least one priced room type", () => {
    const schema = seasonFormSchema(["a", "b"]);
    const values = {
      name: "Summer",
      startDate: "2027-06-01",
      endDate: "2027-08-31",
      daysOfWeek: 127,
      priority: "0",
      prices: { a: { one: "", two: "50" } },
      reason: "seasonal",
    };
    expect(messages(schema.safeParse(values))).toContain(
      "Enter a price for at least one room type",
    );
    expect(schema.safeParse({ ...values, prices: { a: { one: "100", two: "" } } }).success).toBe(
      true,
    );
    expect(
      seasonAmounts({ a: { one: "100", two: "" }, z: { one: "5", two: "" } }, ["a", "b"]),
    ).toEqual([{ roomTypeId: "a", oneAdult: "100", twoAdults: null }]);
  });
});

describe("setup forms", () => {
  it("room type: whole-number limits and fields mapping", () => {
    const schema = roomTypeFormSchema(false);
    const v = {
      code: "DLX",
      name: "Deluxe",
      description: " ",
      maxOccupancy: "3",
      maxAdults: "2",
      maxChildren: "x",
      defaultOccupancy: "2",
      status: "ACTIVE" as const,
      reason: "add",
    };
    expect(messages(schema.safeParse(v))).toEqual(["Max children must be a whole number"]);
    expect(roomTypeFields({ ...v, maxChildren: "1" })).toMatchObject({
      description: undefined,
      maxOccupancy: 3,
      maxChildren: 1,
    });
  });

  it("floor and add-rooms forms", () => {
    expect(
      messages(
        floorFormSchema(true).safeParse({
          code: "",
          name: "",
          level: "a",
          status: "ACTIVE",
          reason: "",
        }),
      ),
    ).toEqual(["Enter a name", "Enter a whole number", "Enter a reason of at least 3 characters"]);
    const schema = addRoomsFormSchema(parseRoomNumbers);
    const v = {
      numbers: "101-103",
      roomTypeId: "t",
      floorId: "",
      housekeepingStatus: "INSPECTED" as const,
      isAccessible: false,
      isSmoking: false,
      reason: "abc",
    };
    expect(schema.safeParse(v).success).toBe(true);
    expect(messages(schema.safeParse({ ...v, numbers: "110-101" }))[0]).toMatch(/counts down/);
    expect(messages(schema.safeParse({ ...v, numbers: "" }))).toContain(
      "Enter at least one room number",
    );
  });

  it("tax form: rate pattern, business date fallback and rate trimming", () => {
    const v = {
      code: "GST",
      name: "GST",
      calculation: "PERCENT" as const,
      basis: "NET" as const,
      rate: "16.00001",
      effectiveFrom: "",
      effectiveTo: "",
      appliesTo: [],
      status: "ACTIVE" as const,
      reason: "tax",
    };
    expect(messages(taxFormSchema(false, "2027-01-01").safeParse(v))).toHaveLength(1);
    expect(messages(taxFormSchema(false, "").safeParse({ ...v, rate: "16" }))).toEqual([
      "Select the first date",
    ]);
    expect(taxFields({ ...v, rate: " 16 " }, "2027-01-01")).toMatchObject({
      rate: "16",
      effectiveFrom: "2027-01-01",
      effectiveTo: null,
    });
    expect(trimRate("16.0000")).toBe("16");
    expect(trimRate("12.5000")).toBe("12.5");
  });

  it("settings: only changed values are sent; identity is frozen once live", () => {
    const config = {
      checkInTime: "14:00",
      checkOutTime: "12:00",
      maxFolioWindows: 2,
      timezone: "Asia/Karachi",
      confirmationPrefix: "SER",
      requireInspectedForCheckIn: true,
      usePickupStatus: false,
      autoNoShowOnNightAudit: false,
      postNoShowCharges: false,
      requireZeroBalanceCheckout: true,
    };
    const v = {
      ...settingsDefaults(config),
      checkInTime: "15:00",
      timezone: "UTC",
      confirmationPrefix: "ab",
      usePickupStatus: true,
    };
    expect(settingsChanges(v, config, false)).toEqual({
      checkInTime: "15:00",
      timezone: "UTC",
      confirmationPrefix: "AB",
      usePickupStatus: true,
    });
    expect(settingsChanges(v, config, true)).toEqual({
      checkInTime: "15:00",
      usePickupStatus: true,
    });
    expect(settingsChanges(settingsDefaults(config), config, false)).toEqual({});
  });

  it("go live: a date or today is enough", () => {
    expect(goLiveFormSchema("2027-01-01").safeParse({ date: "", reason: "go" }).success).toBe(
      false,
    );
    expect(goLiveFormSchema("2027-01-01").safeParse({ date: "", reason: "going" }).success).toBe(
      true,
    );
    expect(messages(goLiveFormSchema(null).safeParse({ date: "", reason: "going" }))).toEqual([
      "Select the first business date",
    ]);
  });
});
