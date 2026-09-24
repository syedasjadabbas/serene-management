"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { TextArea } from "@/components/ui/TextArea";
import { useProperty } from "@/hooks/useProperty";
import { useCheckOutMutation, useStayQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, pluralize } from "@/lib/utils/format";
import { daysBetween } from "@/modules/business-date/business-date.policy";
import type { StayDetail } from "@/modules/front-desk/front-desk.types";

/**
 * Operational check-out: confirms the departure (and, when the guest leaves
 * before the booked date, the early departure with a reason). The room
 * becomes vacant and needs cleaning. The server checks the folio balance
 * (zero-balance rule) and settles the windows in the same transaction.
 */
export function CheckOutDialog({
  open,
  onClose,
  stayId,
  onCheckedOut,
}: {
  open: boolean;
  onClose: () => void;
  stayId: string;
  onCheckedOut?: (stay: StayDetail) => void;
}) {
  const property = useProperty();
  const stay = useStayQuery({ propertyId: property.id, stayId }, { skip: !open });
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [checkOut, { isLoading, error }] = useCheckOutMutation();
  const apiError = toClientApiError(error);
  const data = stay.data;
  const early = data?.checkoutTiming === "EARLY";
  const unusedNights =
    early && data?.businessDate ? daysBetween(data.businessDate, data.departure) : 0;

  async function submit() {
    if (!data) return;
    const result = await checkOut({
      propertyId: property.id,
      stayId,
      body: {
        version: data.version,
        ...(early ? { earlyDeparture: true, reasonCodeId } : {}),
        ...(note.trim() ? { reason: note.trim() } : {}),
      },
    });
    if ("data" in result && result.data) {
      onClose();
      onCheckedOut?.(result.data);
    }
  }

  const sameDay = data?.checkoutTiming === "SAME_DAY";
  const disabled =
    !data || data.status !== "IN_HOUSE" || sameDay || !confirmed || (early && !reasonCodeId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Check out"
      description={data ? `${data.guest.name} · room ${data.room.number}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button pending={isLoading} disabled={disabled} onClick={() => void submit()}>
            Check out
          </Button>
        </>
      }
    >
      {!data ? (
        stay.error ? (
          <Alert tone="danger">{toClientApiError(stay.error)?.message}</Alert>
        ) : (
          <Spinner label="Loading stay" />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
          <p className="text-sm">
            {formatDate(data.arrival)} → {formatDate(data.departure)} ·{" "}
            {pluralize(data.nights, "night")} · {data.confirmation}
          </p>
          {data.checkoutTiming === "ON_TIME" ? (
            <p className="text-sm text-fg-secondary">The guest departs today as booked.</p>
          ) : null}
          {data.checkoutTiming === "OVERSTAY" ? (
            <Alert tone="warning">
              The booked departure was {formatDate(data.departure)}; the guest stayed past it.
            </Alert>
          ) : null}
          {sameDay ? (
            <Alert tone="warning">
              The guest checked in today and has not used a night. A same-day departure cannot be
              processed as a check-out.
            </Alert>
          ) : null}
          {early ? (
            <fieldset className="flex flex-col gap-2 rounded-md border border-warning/40 p-3">
              <legend className="px-1 text-xs text-fg-secondary">Early departure</legend>
              <p className="text-sm">
                Booked until {formatDate(data.departure)}. Checking out today releases{" "}
                {pluralize(unusedNights, "unused night")} back to inventory.
              </p>
              <Select
                label="Reason"
                placeholder="Select a reason"
                options={data.reasonCodes.earlyDeparture.map((r) => ({
                  value: r.id,
                  label: `${r.code} · ${r.name}`,
                }))}
                value={reasonCodeId}
                onChange={(e) => setReasonCodeId(e.target.value)}
              />
            </fieldset>
          ) : null}
          <TextArea
            label="Note (optional, recorded in the audit trail)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
          {data.folio && data.folio.balance !== "0.0000" ? (
            <Alert tone="warning">
              The guest&apos;s account shows{" "}
              {formatCurrency(
                data.folio.balance,
                data.folio.currencyCode,
                "en",
                data.folio.minorUnits,
              )}{" "}
              outstanding. Settle every folio window before check-out; the server refuses the
              check-out while a balance remains (when the property requires a zero balance).
            </Alert>
          ) : data.folio ? (
            <p className="text-sm text-fg-secondary">
              Account balance{" "}
              {formatCurrency("0", data.folio.currencyCode, "en", data.folio.minorUnits)}: the folio
              windows are settled with the check-out.
            </p>
          ) : null}
          <p className="text-xs text-fg-muted">
            Room {data.room.number} becomes vacant and is marked for cleaning.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            The guest is leaving and the room key has been returned.
          </label>
        </div>
      )}
    </Dialog>
  );
}
