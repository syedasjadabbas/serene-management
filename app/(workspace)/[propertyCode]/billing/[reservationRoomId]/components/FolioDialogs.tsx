"use client";

import { type ReactNode, useState } from "react";
import { useDispatch } from "react-redux";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import {
  billingApi,
  useAdjustItemMutation,
  useBillingOptionsQuery,
  usePostChargeMutation,
  usePostPaymentMutation,
  usePostRoomChargesMutation,
  usePreviewChargeMutation,
  useRefundPaymentMutation,
  useReverseItemMutation,
  useSettleFolioMutation,
  useVoidPaymentMutation,
} from "@/lib/api/endpoints/billing.api";
import { type ClientApiError, toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, pluralize } from "@/lib/utils/format";
import { formatMoney, parseMoney } from "@/lib/utils/money";
import type {
  ChargePreview,
  FolioAccountView,
  FolioWindowView,
  LedgerItemView,
} from "@/modules/billing/billing.types";

/**
 * Financial command dialogs. Each dialog chooses one Idempotency-Key when it
 * opens: pressing the button twice, or retrying after a lost response,
 * replays the first result instead of posting again. The browser sends only
 * what the cashier chose; totals, taxes and balances come from the server.
 */

function useIdempotencyKey() {
  const [key] = useState(() => crypto.randomUUID());
  return key;
}

const AMOUNT = /^\d{1,13}(\.\d{1,4})?$/;

/** A decimal string with the currency's minor units (display and form defaults only). */
function toMinor(value: string, minorUnits: number) {
  return formatMoney(parseMoney(value), minorUnits);
}

function FinanceDialog({
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  disabled,
  pending,
  error,
  danger,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
  pending: boolean;
  error: ClientApiError | null;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            pending={pending}
            disabled={disabled}
            onClick={onSubmit}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !pending) onSubmit();
        }}
      >
        {error ? (
          <Alert tone={error.status === 409 ? "warning" : "danger"}>{error.message}</Alert>
        ) : null}
        {children}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function Summary({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-surface-sunken px-3 py-2 text-sm">
      {rows.map(([term, value, strong]) => (
        <div key={term} className="contents">
          <dt className={strong ? "font-semibold" : "text-fg-secondary"}>{term}</dt>
          <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReasonFields({
  categories,
  reasonCodeId,
  setReasonCodeId,
  reason,
  setReason,
  requireCode,
  errors,
}: {
  categories: string[];
  reasonCodeId: string;
  setReasonCodeId: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  requireCode: boolean;
  errors: ClientApiError | null;
}) {
  const property = useProperty();
  const options = useBillingOptionsQuery(property.id);
  return (
    <>
      <Select
        label={requireCode ? "Reason code" : "Reason code (optional)"}
        placeholder="Select"
        options={(options.data?.reasonCodes ?? [])
          .filter((r) => categories.includes(r.category))
          .map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))}
        value={reasonCodeId}
        onChange={(e) => setReasonCodeId(e.target.value)}
        errors={errors?.fieldErrors.reasonCodeId}
      />
      <TextArea
        label="Reason (recorded in the audit trail)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
        errors={errors?.fieldErrors.reason}
      />
    </>
  );
}

// --- Charges ----------------------------------------------------------------------------

export function PostChargeDialog({
  account,
  win,
  onClose,
}: {
  account: FolioAccountView;
  win: FolioWindowView;
  onClose: () => void;
}) {
  const property = useProperty();
  const options = useBillingOptionsQuery(property.id);
  const idempotencyKey = useIdempotencyKey();
  const [codeId, setCodeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitAmount, setUnitAmount] = useState("");
  const [reference, setReference] = useState("");
  const [comment, setComment] = useState("");
  const [preview, setPreview] = useState<ChargePreview | null>(null);
  const [runPreview, previewState] = usePreviewChargeMutation();
  const [post, postState] = usePostChargeMutation();
  const error = toClientApiError(postState.error ?? previewState.error);
  const codes = options.data?.chargeCodes ?? [];

  const qty = Number.parseInt(quantity, 10);
  const valid =
    !!codeId && Number.isInteger(qty) && qty >= 1 && qty <= 999 && AMOUNT.test(unitAmount);
  const body = {
    transactionCodeId: codeId,
    quantity: qty,
    unitAmount,
    ...(reference.trim() ? { reference: reference.trim() } : {}),
    ...(comment.trim() ? { comment: comment.trim() } : {}),
  };
  const edit = (apply: () => void) => {
    apply();
    setPreview(null);
  };

  const submit = async () => {
    if (!preview) {
      const result = await runPreview({ propertyId: property.id, folioId: win.id, body });
      if ("data" in result && result.data) setPreview(result.data);
      return;
    }
    const result = await post({ propertyId: property.id, folioId: win.id, idempotencyKey, body });
    if ("data" in result) onClose();
  };
  const money = (value: string) =>
    formatCurrency(value, account.currencyCode, "en", account.minorUnits);

  return (
    <FinanceDialog
      title={`Post charge · window ${win.window}`}
      description={`Currency ${account.currencyCode} · business date ${formatDate(account.businessDate)}. Taxes are calculated by the server.`}
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel={preview ? `Post ${money(preview.total)}` : "Review"}
      disabled={!valid}
      pending={previewState.isLoading || postState.isLoading}
      error={error}
    >
      <Select
        label="Charge code"
        placeholder={options.isLoading ? "Loading…" : "Select"}
        options={codes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
        value={codeId}
        onChange={(e) =>
          edit(() => {
            setCodeId(e.target.value);
            const code = codes.find((c) => c.id === e.target.value);
            if (code?.defaultPrice && !unitAmount) {
              setUnitAmount(toMinor(code.defaultPrice, account.minorUnits));
            }
          })
        }
        errors={error?.fieldErrors.transactionCodeId}
      />
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <TextField
          label="Quantity"
          inputMode="numeric"
          value={quantity}
          onChange={(e) => edit(() => setQuantity(e.target.value.replace(/\D/g, "")))}
          errors={error?.fieldErrors.quantity}
        />
        <TextField
          label={`Unit price (${account.currencyCode})`}
          inputMode="decimal"
          placeholder="0.00"
          value={unitAmount}
          onChange={(e) => edit(() => setUnitAmount(e.target.value.trim()))}
          errors={error?.fieldErrors.unitAmount}
        />
      </div>
      <TextField
        label="Reference (optional)"
        placeholder="Check or voucher number"
        value={reference}
        onChange={(e) => edit(() => setReference(e.target.value))}
        maxLength={100}
      />
      <TextField
        label="Comment (optional)"
        value={comment}
        onChange={(e) => edit(() => setComment(e.target.value))}
        maxLength={500}
      />
      {preview ? (
        <Summary
          rows={[
            [`Net${preview.inclusive ? " (tax included in price)" : ""}`, money(preview.net)],
            ...preview.taxes.map((t) => [t.name, money(t.amount)] as [string, string]),
            ["Total charge", money(preview.total), true],
            ["Balance after posting", money(preview.balanceAfter)],
          ]}
        />
      ) : null}
    </FinanceDialog>
  );
}

export function RoomChargesDialog({
  account,
  onClose,
}: {
  account: FolioAccountView;
  onClose: () => void;
}) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const [post, state] = usePostRoomChargesMutation();
  const nights = account.roomCharges.unpostedNights;
  return (
    <FinanceDialog
      title="Post room charges"
      description="Posts the room rate (with packages and taxes) of each past night that has not been posted. Tonight's charge is posted by night audit."
      onClose={onClose}
      onSubmit={async () => {
        const result = await post({
          propertyId: property.id,
          reservationRoomId: account.reservationRoomId,
          idempotencyKey,
          body: {},
        });
        if ("data" in result) onClose();
      }}
      submitLabel={`Post ${pluralize(nights.length, "night")}`}
      disabled={nights.length === 0}
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      <ul className="list-inside list-disc text-sm">
        {nights.map((night) => (
          <li key={night}>Night of {formatDate(night)}</li>
        ))}
      </ul>
      <p className="text-xs text-fg-muted">
        Rates come from the reservation; each night can be posted only once.
      </p>
    </FinanceDialog>
  );
}

// --- Payments ----------------------------------------------------------------------------

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
  const [methodId, setMethodId] = useState("");
  const [amount, setAmount] = useState(() => toMinor(win.balance, account.minorUnits));
  const [reference, setReference] = useState("");
  const [pay, state] = usePostPaymentMutation();
  const error = toClientApiError(state.error);
  const method = options.data?.paymentMethods.find((m) => m.id === methodId);
  const valid =
    !!methodId && AMOUNT.test(amount) && (!method?.requiresReference || !!reference.trim());
  const money = (value: string) =>
    formatCurrency(value, account.currencyCode, "en", account.minorUnits);
  // Preview only; the server recomputes the balance from the ledger.
  const after = AMOUNT.test(amount)
    ? formatMoney(parseMoney(win.balance) - parseMoney(amount))
    : null;

  return (
    <FinanceDialog
      title={`Take payment · window ${win.window}`}
      description={`Payments are taken in ${account.currencyCode}. Card payments are recorded from the hotel's terminal; no card data is entered here.`}
      onClose={onClose}
      onSubmit={async () => {
        const result = await pay({
          propertyId: property.id,
          folioId: win.id,
          idempotencyKey,
          body: {
            methodId,
            amount,
            version: win.version,
            currencyCode: account.currencyCode,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
          },
        });
        if ("data" in result) onClose();
        // Someone else changed the balance: refresh so the new figure is shown.
        else if (toClientApiError(result.error)?.status === 409) {
          dispatch(billingApi.util.invalidateTags(["Folio"]));
        }
      }}
      submitLabel={AMOUNT.test(amount) ? `Take ${money(amount)}` : "Take payment"}
      disabled={!valid}
      pending={state.isLoading}
      error={error}
    >
      <Summary
        rows={[
          ["Balance due", money(win.balance), true],
          ["Balance after this payment", after ? money(after) : "—"],
        ]}
      />
      <Select
        label="Payment method"
        placeholder={options.isLoading ? "Loading…" : "Select"}
        options={(options.data?.paymentMethods ?? []).map((m) => ({ value: m.id, label: m.name }))}
        value={methodId}
        onChange={(e) => setMethodId(e.target.value)}
        errors={error?.fieldErrors.methodId}
      />
      <TextField
        label={`Amount (${account.currencyCode})`}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.trim())}
        errors={error?.fieldErrors.amount}
        hint="At most the balance due."
      />
      <TextField
        label={method?.requiresReference ? "Reference (required)" : "Reference (optional)"}
        placeholder={
          method?.kind === "CREDIT_CARD"
            ? "Terminal approval code"
            : "Receipt or transfer reference"
        }
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        maxLength={100}
        errors={error?.fieldErrors.reference}
      />
    </FinanceDialog>
  );
}

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
    <FinanceDialog
      title={`Settle window ${win.window}`}
      description="Confirms that this window is paid in full. A later posting reopens it."
      onClose={onClose}
      onSubmit={async () => {
        const result = await settle({
          propertyId: property.id,
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
    </FinanceDialog>
  );
}

// --- Corrections ---------------------------------------------------------------------------

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

export function ReverseDialog({
  account,
  item,
  onClose,
}: {
  account: FolioAccountView;
  item: LedgerItemView;
  onClose: () => void;
}) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [reverse, state] = useReverseItemMutation();
  const error = toClientApiError(state.error);
  return (
    <FinanceDialog
      title="Reverse charge"
      description="Posts an exact negation of this charge and its taxes. The original line stays in the ledger."
      onClose={onClose}
      onSubmit={async () => {
        const result = await reverse({
          propertyId: property.id,
          itemId: item.id,
          idempotencyKey,
          body: { reason: reason.trim(), ...(reasonCodeId ? { reasonCodeId } : {}) },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Reverse"
      danger
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Summary rows={itemSummary(item, account)} />
      <ReasonFields
        categories={["VOID"]}
        reasonCodeId={reasonCodeId}
        setReasonCodeId={setReasonCodeId}
        reason={reason}
        setReason={setReason}
        requireCode={false}
        errors={error}
      />
    </FinanceDialog>
  );
}

export function AdjustDialog({
  account,
  item,
  onClose,
}: {
  account: FolioAccountView;
  item: LedgerItemView;
  onClose: () => void;
}) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const [amount, setAmount] = useState("");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [adjust, state] = useAdjustItemMutation();
  const error = toClientApiError(state.error);
  return (
    <FinanceDialog
      title="Adjust charge"
      description="Credits part or all of this charge; its taxes are credited in proportion. The original line is not changed."
      onClose={onClose}
      onSubmit={async () => {
        const result = await adjust({
          propertyId: property.id,
          itemId: item.id,
          idempotencyKey,
          body: { amount, reasonCodeId, reason: reason.trim() },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Adjust"
      danger
      disabled={!AMOUNT.test(amount) || !reasonCodeId || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
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
      <TextField
        label={`Amount to credit, taxes included (${account.currencyCode})`}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.trim())}
        errors={error?.fieldErrors.amount}
      />
      <ReasonFields
        categories={["ADJUSTMENT"]}
        reasonCodeId={reasonCodeId}
        setReasonCodeId={setReasonCodeId}
        reason={reason}
        setReason={setReason}
        requireCode
        errors={error}
      />
    </FinanceDialog>
  );
}

export function VoidDialog({
  account,
  item,
  onClose,
}: {
  account: FolioAccountView;
  item: LedgerItemView;
  onClose: () => void;
}) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [voidPayment, state] = useVoidPaymentMutation();
  const error = toClientApiError(state.error);
  return (
    <FinanceDialog
      title="Void payment"
      description="For a payment taken today by mistake: the payment becomes void and its amount returns to the balance. Earlier payments are refunded instead."
      onClose={onClose}
      onSubmit={async () => {
        const result = await voidPayment({
          propertyId: property.id,
          paymentId: item.payment!.id,
          idempotencyKey,
          body: { reason: reason.trim(), ...(reasonCodeId ? { reasonCodeId } : {}) },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Void payment"
      danger
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
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
      <ReasonFields
        categories={["VOID"]}
        reasonCodeId={reasonCodeId}
        setReasonCodeId={setReasonCodeId}
        reason={reason}
        setReason={setReason}
        requireCode={false}
        errors={error}
      />
    </FinanceDialog>
  );
}

export function RefundDialog({
  account,
  item,
  onClose,
}: {
  account: FolioAccountView;
  item: LedgerItemView;
  onClose: () => void;
}) {
  const property = useProperty();
  const idempotencyKey = useIdempotencyKey();
  const refundable = item.payment?.refundable ?? "0";
  const [amount, setAmount] = useState(() => toMinor(refundable, account.minorUnits));
  const [reference, setReference] = useState("");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [refund, state] = useRefundPaymentMutation();
  const error = toClientApiError(state.error);
  return (
    <FinanceDialog
      title="Refund payment"
      description="Returns money against this payment. The refund is recorded against the original payment and never exceeds what was paid."
      onClose={onClose}
      onSubmit={async () => {
        const result = await refund({
          propertyId: property.id,
          paymentId: item.payment!.id,
          idempotencyKey,
          body: {
            amount,
            reasonCodeId,
            reason: reason.trim(),
            ...(reference.trim() ? { reference: reference.trim() } : {}),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel={
        AMOUNT.test(amount)
          ? `Refund ${formatCurrency(amount, account.currencyCode, "en", account.minorUnits)}`
          : "Refund"
      }
      danger
      disabled={!AMOUNT.test(amount) || !reasonCodeId || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
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
      <TextField
        label={`Refund amount (${account.currencyCode})`}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.trim())}
        errors={error?.fieldErrors.amount}
      />
      <TextField
        label="Reference (optional)"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        maxLength={100}
      />
      <ReasonFields
        categories={["REFUND"]}
        reasonCodeId={reasonCodeId}
        setReasonCodeId={setReasonCodeId}
        reason={reason}
        setReason={setReason}
        requireCode
        errors={error}
      />
    </FinanceDialog>
  );
}
