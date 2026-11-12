"use client";

import { FormTextField, applyServerError, useZodForm } from "@/global/components/ui/form";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useAdjustItemMutation,
  useRefundPaymentMutation,
  useReverseItemMutation,
  useVoidPaymentMutation,
} from "@/global/api/endpoints/billingApi";
import { toClientApiError } from "@/global/api/errors";
import { formatCurrency, formatDate } from "@serene/shared/lib/utils/format";
import type {
  FolioAccountView,
  LedgerItemView,
} from "@serene/shared/modules/billing/billing.types";
import {
  AMOUNT,
  adjustDefaults,
  adjustFormSchema,
  reasonCodeBody,
  reasonOnlyDefaults,
  reasonOnlyFormSchema,
  refundDefaults,
  refundFormSchema,
} from "../_lib/folioForms";
import { ReasonFields, Summary, useIdempotencyKey } from "./FolioDialogParts";

interface CorrectionProps {
  account: FolioAccountView;
  item: LedgerItemView;
  onClose: () => void;
}

function itemSummary(
  item: LedgerItemView,
  account: FolioAccountView,
): [string, string, boolean?][] {
  return [
    ["Posting", `${item.code.code} · ${item.description}`],
    ["Business date", formatDate(item.businessDate)],
    ["Amount", formatCurrency(item.amount, account.currencyCode, "en", account.minorUnits), true],
  ];
}

export function ReverseDialog({ account, item, onClose }: CorrectionProps) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const { control, handleSubmit, setError, formState } = useZodForm(
    reasonOnlyFormSchema,
    reasonOnlyDefaults,
  );
  const [reverse, state] = useReverseItemMutation();
  return (
    <FormDialog
      title="Reverse charge"
      description="Posts an exact negation of this charge and its taxes. The original line stays in the ledger."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await reverse({
          propertyId: property.id,
          reservationRoomId: account.reservationRoomId,
          itemId: item.id,
          idempotencyKey,
          body: reasonCodeBody(values),
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Reverse"
      danger
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <Summary rows={itemSummary(item, account)} />
      <ReasonFields control={control} categories={["VOID"]} requireCode={false} />
    </FormDialog>
  );
}

export function AdjustDialog({ account, item, onClose }: CorrectionProps) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const { control, handleSubmit, setError, setValue, formState } = useZodForm(
    adjustFormSchema,
    adjustDefaults,
  );
  const [adjust, state] = useAdjustItemMutation();
  return (
    <FormDialog
      title="Adjust charge"
      description="Credits part or all of this charge; its taxes are credited in proportion. The original line is not changed."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await adjust({
          propertyId: property.id,
          reservationRoomId: account.reservationRoomId,
          itemId: item.id,
          idempotencyKey,
          body: {
            amount: values.amount,
            reasonCodeId: values.reasonCodeId,
            reason: values.reason.trim(),
          },
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Adjust"
      danger
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <Summary
        rows={[
          ...itemSummary(item, account),
          ...(item.adjusted !== "0.0000"
            ? ([
                [
                  "Already adjusted",
                  formatCurrency(item.adjusted, account.currencyCode, "en", account.minorUnits),
                ],
              ] as [string, string][])
            : []),
        ]}
      />
      <FormTextField
        control={control}
        name="amount"
        label={`Amount to credit, taxes included (${account.currencyCode})`}
        inputMode="decimal"
        onChange={(e) => setValue("amount", e.target.value.trim())}
      />
      <ReasonFields control={control} categories={["ADJUSTMENT"]} requireCode />
    </FormDialog>
  );
}

export function VoidDialog({ account, item, onClose }: CorrectionProps) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const { control, handleSubmit, setError, formState } = useZodForm(
    reasonOnlyFormSchema,
    reasonOnlyDefaults,
  );
  const [voidPayment, state] = useVoidPaymentMutation();
  return (
    <FormDialog
      title="Void payment"
      description="For a payment taken today by mistake: the payment becomes void and its amount returns to the balance. Earlier payments are refunded instead."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await voidPayment({
          propertyId: property.id,
          reservationRoomId: account.reservationRoomId,
          paymentId: item.payment!.id,
          idempotencyKey,
          body: reasonCodeBody(values),
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Void payment"
      danger
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <Summary
        rows={[
          ["Receipt", item.payment?.receiptNumber ?? "—"],
          ["Method", item.payment?.method ?? "—"],
          [
            "Amount",
            formatCurrency(
              item.amount.replace(/^-/, ""),
              account.currencyCode,
              "en",
              account.minorUnits,
            ),
            true,
          ],
        ]}
      />
      <ReasonFields control={control} categories={["VOID"]} requireCode={false} />
    </FormDialog>
  );
}

export function RefundDialog({ account, item, onClose }: CorrectionProps) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const refundable = item.payment?.refundable ?? "0";
  const { control, handleSubmit, setError, setValue, watch, formState } = useZodForm(
    refundFormSchema,
    refundDefaults(refundable, account.minorUnits),
  );
  const amount = watch("amount");
  const [refund, state] = useRefundPaymentMutation();
  return (
    <FormDialog
      title="Refund payment"
      description="Returns money against this payment. The refund is recorded against the original payment and never exceeds what was paid."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await refund({
          propertyId: property.id,
          reservationRoomId: account.reservationRoomId,
          paymentId: item.payment!.id,
          idempotencyKey,
          body: {
            amount: values.amount,
            reasonCodeId: values.reasonCodeId,
            reason: values.reason.trim(),
            ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
          },
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel={
        AMOUNT.test(amount)
          ? `Refund ${formatCurrency(amount, account.currencyCode, "en", account.minorUnits)}`
          : "Refund"
      }
      danger
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <Summary
        rows={[
          ["Receipt", item.payment?.receiptNumber ?? "—"],
          ["Method", item.payment?.method ?? "—"],
          [
            "Refundable",
            formatCurrency(refundable, account.currencyCode, "en", account.minorUnits),
            true,
          ],
        ]}
      />
      <FormTextField
        control={control}
        name="amount"
        label={`Refund amount (${account.currencyCode})`}
        inputMode="decimal"
        onChange={(e) => setValue("amount", e.target.value.trim())}
      />
      <FormTextField
        control={control}
        name="reference"
        label="Reference (optional)"
        maxLength={100}
      />
      <ReasonFields control={control} categories={["REFUND"]} requireCode />
    </FormDialog>
  );
}
