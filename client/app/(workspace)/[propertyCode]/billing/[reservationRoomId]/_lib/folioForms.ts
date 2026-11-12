import { z } from "zod";
import { formatMoney, parseMoney } from "@serene/shared/lib/utils/money";
import { type PaymentKind, paymentProblem } from "@serene/shared/modules/billing/billing.policy";

/** A decimal string with up to four decimals (the server's money check is the authority). */
export const AMOUNT = /^\d{1,13}(\.\d{1,4})?$/;

/** A decimal string with the currency's minor units (display and form defaults only). */
export function toMinor(value: string, minorUnits: number) {
  return formatMoney(parseMoney(value), minorUnits);
}

const amountField = (message = "Enter a valid amount") => z.string().regex(AMOUNT, message);
const reasonField = z.string().refine((v) => v.trim().length >= 3, {
  message: "Enter a reason of at least 3 characters",
});
const NO_CODE = "Select a reason code";

// --- Post charge -------------------------------------------------------------------------

export const postChargeFormSchema = z.object({
  codeId: z.string().min(1, "Select a charge code"),
  quantity: z.string().refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 999, {
    message: "Quantity must be a whole number from 1 to 999",
  }),
  unitAmount: amountField("Enter a valid unit price"),
  reference: z.string().max(100),
  comment: z.string().max(500),
});
export type PostChargeFormValues = z.infer<typeof postChargeFormSchema>;
export const postChargeDefaults: PostChargeFormValues = {
  codeId: "",
  quantity: "1",
  unitAmount: "",
  reference: "",
  comment: "",
};

/** Request body shared by the charge preview and the posting. */
export function postChargeBody(values: PostChargeFormValues) {
  return {
    transactionCodeId: values.codeId,
    quantity: Number.parseInt(values.quantity, 10),
    unitAmount: values.unitAmount,
    ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
    ...(values.comment.trim() ? { comment: values.comment.trim() } : {}),
  };
}

// --- Payment -----------------------------------------------------------------------------

export const paymentFormDefaults = (balance: string, minorUnits: number) => {
  const owes = parseMoney(balance) > 0n;
  return {
    kind: (owes ? "PAYMENT" : "DEPOSIT") as PaymentKind,
    methodId: "",
    amount: owes ? toMinor(balance, minorUnits) : "",
    reference: "",
  };
};

/**
 * Payment window rules: a method, a valid amount that passes the shared
 * `paymentProblem` policy (same rule the server applies), and a reference
 * when the chosen method requires one. With nothing owed only a deposit is
 * possible.
 */
export function paymentFormSchema(
  balance: bigint,
  referenceRequired: (methodId: string) => boolean,
) {
  return z
    .object({
      kind: z.enum(["PAYMENT", "DEPOSIT"]),
      methodId: z.string().min(1, "Select a payment method"),
      amount: z.string(),
      reference: z.string().max(100),
    })
    .superRefine((value, ctx) => {
      if (!AMOUNT.test(value.amount)) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter a valid amount" });
      } else {
        const kind: PaymentKind = balance > 0n ? value.kind : "DEPOSIT";
        const problem = paymentProblem(parseMoney(value.amount), balance, kind);
        if (problem) ctx.addIssue({ code: "custom", path: ["amount"], message: problem });
      }
      if (referenceRequired(value.methodId) && !value.reference.trim()) {
        ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter a reference" });
      }
    });
}

// --- Corrections -------------------------------------------------------------------------

/** Reverse / void: free-text reason, reason code optional. */
export const reasonOnlyFormSchema = z.object({ reasonCodeId: z.string(), reason: reasonField });
export const reasonOnlyDefaults = { reasonCodeId: "", reason: "" };

/** Adjust: amount to credit, a reason code and a reason. */
export const adjustFormSchema = z.object({
  amount: amountField(),
  reasonCodeId: z.string().min(1, NO_CODE),
  reason: reasonField,
});
export const adjustDefaults = { amount: "", reasonCodeId: "", reason: "" };

export const refundFormSchema = z.object({
  amount: amountField(),
  reference: z.string().max(100),
  reasonCodeId: z.string().min(1, NO_CODE),
  reason: reasonField,
});
export const refundDefaults = (refundable: string, minorUnits: number) => ({
  amount: toMinor(refundable, minorUnits),
  reference: "",
  reasonCodeId: "",
  reason: "",
});

export const reasonCodeBody = (values: { reasonCodeId: string; reason: string }) => ({
  reason: values.reason.trim(),
  ...(values.reasonCodeId ? { reasonCodeId: values.reasonCodeId } : {}),
});
