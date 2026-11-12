"use client";

import { useDispatch } from "react-redux";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { ToggleGroup } from "@/global/components/ui/ToggleGroup";
import {
  FormSelect,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import {
  billingApi,
  useBillingOptionsQuery,
  usePostPaymentMutation,
  useSettleFolioMutation,
} from "@/global/api/endpoints/billingApi";
import { toClientApiError } from "@/global/api/errors";
import { formatCurrency } from "@serene/shared/lib/utils/format";
import { formatMoney, parseMoney } from "@serene/shared/lib/utils/money";
import type { PaymentKind } from "@serene/shared/modules/billing/billing.policy";
import type {
  FolioAccountView,
  FolioWindowView,
} from "@serene/shared/modules/billing/billing.types";
import { AMOUNT, paymentFormDefaults, paymentFormSchema, toMinor } from "../_lib/folioForms";
import { Summary, useIdempotencyKey } from "./FolioDialogParts";

export function PaymentDialog({
  account,
  win,
  onClose,
}: {
  account: FolioAccountView;
  win: FolioWindowView;
  onClose: () => void;
}) {
  const property = useProperty();
  const dispatch = useDispatch();
  const options = useBillingOptionsQuery(property.id);
  const idempotencyKey = useIdempotencyKey();
  const balance = parseMoney(win.balance);
  // With nothing owed the only possible payment is an advance (deposit).
  const owes = balance > 0n;
  const methods = options.data?.paymentMethods ?? [];
  const schema = paymentFormSchema(
    balance,
    (id) => methods.find((m) => m.id === id)?.requiresReference ?? false,
  );
  const { control, handleSubmit, setError, setValue, watch, formState } = useZodForm(
    schema,
    paymentFormDefaults(win.balance, account.minorUnits),
  );
  const [pay, state] = usePostPaymentMutation();
  const error = toClientApiError(state.error);
  const kind: PaymentKind = owes ? watch("kind") : "DEPOSIT";
  const amount = watch("amount");
  const method = methods.find((m) => m.id === watch("methodId"));
  const amountOk = AMOUNT.test(amount);
  const money = (value: string) =>
    formatCurrency(value, account.currencyCode, "en", account.minorUnits);
  const deposit = kind === "DEPOSIT";
  // Preview only; the server recomputes the balance from the ledger.
  const after = amountOk ? balance - parseMoney(amount) : null;
  const afterCredit = after !== null && after < 0n;

  async function submit(values: { methodId: string; amount: string; reference: string }) {
    const result = await pay({
      propertyId: property.id,
      reservationRoomId: account.reservationRoomId,
      folioId: win.id,
      idempotencyKey,
      body: {
        methodId: values.methodId,
        kind,
        amount: values.amount,
        version: win.version,
        currencyCode: account.currencyCode,
        ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
      },
    });
    if ("data" in result) onClose();
    else {
      const apiError = toClientApiError(result.error);
      applyServerError(setError, apiError);
      // Someone else changed the balance: refresh so the new figure is shown.
      if (apiError?.status === 409) dispatch(billingApi.util.invalidateTags(["Folio"]));
    }
  }

  return (
    <FormDialog
      title={`${deposit ? "Take deposit / advance" : "Take payment"} · window ${win.window}`}
      description={`Payments are taken in ${account.currencyCode}. Card payments are recorded from the hotel's terminal; no card data is entered here.${
        deposit
          ? " A deposit is held as a credit on this window and must be used or refunded before check-out."
          : ""
      }`}
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={amountOk ? `Take ${deposit ? "deposit " : ""}${money(amount)}` : "Take payment"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <Summary
        rows={[
          balance < 0n
            ? ["Credit on window", money(formatMoney(-balance)), true]
            : ["Balance due", money(win.balance), true],
          [
            afterCredit ? "Credit after this payment" : "Balance after this payment",
            after === null ? "—" : money(formatMoney(afterCredit ? -after : after)),
          ],
        ]}
      />
      {owes ? (
        <ToggleGroup
          label="Payment type"
          options={[
            { value: "PAYMENT", label: "Payment" },
            { value: "DEPOSIT", label: "Deposit / advance" },
          ]}
          value={kind}
          onChange={(next) => {
            setValue("kind", next);
            setValue("amount", next === "PAYMENT" ? toMinor(win.balance, account.minorUnits) : "");
          }}
        />
      ) : null}
      <FormSelect
        control={control}
        name="methodId"
        label="Payment method"
        placeholder={options.isLoading ? "Loading…" : "Select"}
        options={methods.map((m) => ({ value: m.id, label: m.name }))}
      />
      <FormTextField
        control={control}
        name="amount"
        label={`Amount (${account.currencyCode})`}
        inputMode="decimal"
        onChange={(e) => setValue("amount", e.target.value.trim())}
        hint={
          deposit
            ? owes
              ? "More than the balance due; the excess stays as credit."
              : "Paid in advance; held as credit until charges are posted."
            : "At most the balance due."
        }
      />
      <FormTextField
        control={control}
        name="reference"
        label={method?.requiresReference ? "Reference (required)" : "Reference (optional)"}
        placeholder={
          method?.kind === "CREDIT_CARD"
            ? "Terminal approval code"
            : "Receipt or transfer reference"
        }
        maxLength={100}
      />
    </FormDialog>
  );
}

/** No inputs: a one-button command dialog. */
export function SettleDialog({
  account,
  win,
  onClose,
}: {
  account: FolioAccountView;
  win: FolioWindowView;
  onClose: () => void;
}) {
  const property = useProperty();
  const [settle, state] = useSettleFolioMutation();
  return (
    <FormDialog
      title={`Settle window ${win.window}`}
      description="Confirms that this window is paid in full. A later posting reopens it."
      onClose={onClose}
      onSubmit={async () => {
        const result = await settle({
          propertyId: property.id,
          reservationRoomId: account.reservationRoomId,
          folioId: win.id,
          version: win.version,
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Settle"
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      <Summary
        rows={[
          [
            "Balance",
            formatCurrency(win.balance, account.currencyCode, "en", account.minorUnits),
            true,
          ],
        ]}
      />
    </FormDialog>
  );
}
