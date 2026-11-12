import { describe, expect, it } from "vitest";
import {
  adjustFormSchema,
  paymentFormDefaults,
  paymentFormSchema,
  postChargeBody,
  postChargeDefaults,
  postChargeFormSchema,
  reasonCodeBody,
  reasonOnlyFormSchema,
  refundDefaults,
} from "@/app/(workspace)/[propertyCode]/billing/[reservationRoomId]/_lib/folioForms";

type Result = {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
};
const messages = (result: Result) =>
  Object.fromEntries((result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

describe("post charge form", () => {
  it("requires code, quantity 1-999 and a decimal price", () => {
    const bad = postChargeFormSchema.safeParse({
      ...postChargeDefaults,
      quantity: "0",
      unitAmount: "x",
    });
    expect(messages(bad)).toMatchObject({
      codeId: "Select a charge code",
      quantity: "Quantity must be a whole number from 1 to 999",
      unitAmount: "Enter a valid unit price",
    });
  });
  it("builds the request body without empty optionals", () => {
    const values = { ...postChargeDefaults, codeId: "c1", unitAmount: "10.50", reference: " r " };
    expect(postChargeFormSchema.safeParse(values).success).toBe(true);
    expect(postChargeBody(values)).toEqual({
      transactionCodeId: "c1",
      quantity: 1,
      unitAmount: "10.50",
      reference: "r",
    });
  });
});

describe("payment form", () => {
  const schema = (balance: bigint, needsRef = false) => paymentFormSchema(balance, () => needsRef);
  it("defaults to a payment of the balance, or a deposit when nothing is owed", () => {
    expect(paymentFormDefaults("120.5", 2)).toMatchObject({ kind: "PAYMENT", amount: "120.50" });
    expect(paymentFormDefaults("0", 2)).toMatchObject({ kind: "DEPOSIT", amount: "" });
  });
  it("applies the shared payment policy and the reference rule", () => {
    const errors = messages(
      schema(10000n, true).safeParse({
        kind: "PAYMENT",
        methodId: "m",
        amount: "999999",
        reference: " ",
      }),
    );
    expect(errors.amount).toBeTruthy();
    expect(errors.reference).toBe("Enter a reference");
    expect(
      schema(10000n).safeParse({ kind: "PAYMENT", methodId: "m", amount: "1", reference: "" })
        .success,
    ).toBe(true);
  });
  it("requires a method and a valid amount", () => {
    expect(
      messages(schema(0n).safeParse({ kind: "DEPOSIT", methodId: "", amount: "", reference: "" })),
    ).toMatchObject({
      methodId: "Select a payment method",
      amount: "Enter a valid amount",
    });
  });
});

describe("correction forms", () => {
  it("reverse needs a 3 character reason; the code is optional", () => {
    expect(reasonOnlyFormSchema.safeParse({ reasonCodeId: "", reason: "ab" }).success).toBe(false);
    const ok = { reasonCodeId: "", reason: " typo " };
    expect(reasonOnlyFormSchema.safeParse(ok).success).toBe(true);
    expect(reasonCodeBody(ok)).toEqual({ reason: "typo" });
  });
  it("adjust needs amount, code and reason", () => {
    expect(
      messages(adjustFormSchema.safeParse({ amount: "", reasonCodeId: "", reason: "" })),
    ).toMatchObject({ reasonCodeId: "Select a reason code" });
  });
  it("refund defaults to the refundable amount", () => {
    expect(refundDefaults("40", 2).amount).toBe("40.00");
  });
});
