"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useBillingOptionsQuery,
  usePostChargeMutation,
  usePostRoomChargesMutation,
  usePreviewChargeMutation,
} from "@/global/api/endpoints/billingApi";
import { type ClientApiError, toClientApiError } from "@/global/api/errors";
import { formatCurrency, formatDate, pluralize } from "@serene/shared/lib/utils/format";
import type {
  ChargePreview,
  FolioAccountView,
  FolioWindowView,
} from "@serene/shared/modules/billing/billing.types";
import {
  type PostChargeFormValues,
  postChargeBody,
  postChargeDefaults,
  postChargeFormSchema,
  toMinor,
} from "../_lib/folioForms";
import { Summary, useIdempotencyKey } from "./FolioDialogParts";

/** The server calls the charge code transactionCodeId; the form field is codeId. */
function chargeFieldNames(error: ClientApiError | null): ClientApiError | null {
  if (!error?.fieldErrors.transactionCodeId) return error;
  return {
    ...error,
    fieldErrors: { ...error.fieldErrors, codeId: error.fieldErrors.transactionCodeId },
  };
}

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
  const [preview, setPreview] = useState<ChargePreview | null>(null);
  const [runPreview, previewState] = usePreviewChargeMutation();
  const [post, postState] = usePostChargeMutation();
  const error = toClientApiError(postState.error ?? previewState.error);
  const codes = options.data?.chargeCodes ?? [];
  const { control, handleSubmit, setError, setValue, getValues, watch, formState } = useZodForm(
    postChargeFormSchema,
    postChargeDefaults,
  );

  // Any edit invalidates a shown preview: the cashier reviews again.
  useEffect(() => {
    const subscription = watch(() => setPreview(null));
    return () => subscription.unsubscribe();
  }, [watch]);

  const submit = async (values: PostChargeFormValues) => {
    const body = postChargeBody(values);
    if (!preview) {
      const result = await runPreview({ propertyId: property.id, folioId: win.id, body });
      if ("data" in result && result.data) setPreview(result.data);
      else if ("error" in result)
        applyServerError(setError, chargeFieldNames(toClientApiError(result.error)));
      return;
    }
    const result = await post({
      propertyId: property.id,
      reservationRoomId: account.reservationRoomId,
      folioId: win.id,
      idempotencyKey,
      body,
    });
    if ("data" in result) onClose();
    else applyServerError(setError, chargeFieldNames(toClientApiError(result.error)));
  };
  const money = (value: string) =>
    formatCurrency(value, account.currencyCode, "en", account.minorUnits);

  return (
    <FormDialog
      title={`Post charge · window ${win.window}`}
      description={`Currency ${account.currencyCode} · business date ${formatDate(account.businessDate)}. Taxes are calculated by the server.`}
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={preview ? `Post ${money(preview.total)}` : "Review"}
      pending={previewState.isLoading || postState.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormSelect
        control={control}
        name="codeId"
        label="Charge code"
        placeholder={options.isLoading ? "Loading…" : "Select"}
        options={codes.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
        onChange={(e) => {
          const code = codes.find((c) => c.id === e.target.value);
          if (code?.defaultPrice && !getValues("unitAmount")) {
            setValue("unitAmount", toMinor(code.defaultPrice, account.minorUnits));
          }
        }}
      />
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
        <FormTextField
          control={control}
          name="quantity"
          label="Quantity"
          inputMode="numeric"
          onChange={(e) => setValue("quantity", e.target.value.replace(/\D/g, ""))}
        />
        <FormTextField
          control={control}
          name="unitAmount"
          label={`Unit price (${account.currencyCode})`}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => setValue("unitAmount", e.target.value.trim())}
        />
      </div>
      <FormTextField
        control={control}
        name="reference"
        label="Reference (optional)"
        placeholder="Check or voucher number"
        maxLength={100}
      />
      <FormTextField control={control} name="comment" label="Comment (optional)" maxLength={500} />
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
    </FormDialog>
  );
}

/** No inputs: a one-button command dialog. */
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
    <FormDialog
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
    </FormDialog>
  );
}
