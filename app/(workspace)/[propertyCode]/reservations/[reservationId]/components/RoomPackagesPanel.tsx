"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { usePackagesQuery } from "@/lib/api/endpoints/rates.api";
import {
  useAddReservationPackageMutation,
  useChargeEstimateQuery,
  useRemoveReservationPackageMutation,
} from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, formatShortDate } from "@/lib/utils/format";
import { addDays } from "@/modules/business-date/business-date.policy";
import type { ReservationRoomDetail } from "@/modules/reservations/reservations.types";

/**
 * Packages booked on the room and the server's estimate of what will post to
 * the folio each night (room line after the package carve-out, package lines,
 * taxes). The estimate uses the same line builder as the nightly posting.
 */
export function RoomPackagesPanel({
  room,
  businessDate,
}: {
  room: ReservationRoomDetail;
  businessDate: string | null;
}) {
  const property = useProperty();
  const [adding, setAdding] = useState(false);
  const estimate = useChargeEstimateQuery({ propertyId: property.id, reservationRoomId: room.id });
  const [remove, removeState] = useRemoveReservationPackageMutation();
  const removeError = toClientApiError(removeState.error);
  const estimateError = toClientApiError(estimate.error);
  const manage = room.allowedActions.managePackages;
  const e = estimate.data;

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Packages</h3>
        {manage ? (
          <Button
            size="sm"
            variant="secondary"
            className="ms-auto min-h-11 md:min-h-0"
            onClick={() => setAdding(true)}
          >
            Add package
          </Button>
        ) : null}
      </div>
      {room.packages.length === 0 ? (
        <p className="text-sm text-fg-secondary">Only what the rate plan includes.</p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {room.packages.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium">
                {p.code} · {p.name}
              </span>
              <span className="text-xs text-fg-muted">
                ×{p.quantity} · {formatShortDate(p.startDate)} → {formatShortDate(p.endDate)}
              </span>
              {manage && businessDate !== null && p.startDate > businessDate ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-auto min-h-11 md:min-h-0"
                  pending={
                    removeState.isLoading && removeState.originalArgs?.reservationPackageId === p.id
                  }
                  onClick={() =>
                    void remove({
                      propertyId: property.id,
                      reservationRoomId: room.id,
                      reservationPackageId: p.id,
                    })
                  }
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {removeError ? <p className="text-sm text-danger">{removeError.message}</p> : null}

      <h3 className="text-sm font-semibold">Charge estimate</h3>
      {estimate.isLoading ? <p className="text-sm text-fg-muted">Calculating…</p> : null}
      {estimateError ? <p className="text-sm text-danger">{estimateError.message}</p> : null}
      {e ? (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Estimated folio charges per night</caption>
            <thead className="text-left text-xs text-fg-secondary">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Night
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Line
                </th>
                <th scope="col" className="py-1 pr-3 text-end font-medium">
                  Net
                </th>
                <th scope="col" className="py-1 pr-3 text-end font-medium">
                  Tax
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {e.nights.flatMap((night) =>
                night.lines.map((line, index) => (
                  <tr
                    key={`${night.date}-${index}`}
                    className={index === 0 ? "border-t border-border-subtle" : undefined}
                  >
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {index === 0 ? (
                        <>
                          {formatDate(night.date)}
                          {night.posted ? (
                            <span className="ms-1 text-xs text-fg-muted">(posted)</span>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                    <td className="py-1 pr-3">
                      {line.description}
                      {line.quantity > 1 ? ` ×${line.quantity}` : ""}
                    </td>
                    <td className="py-1 pr-3 text-end">
                      {formatCurrency(line.net, e.currencyCode, "en", e.minorUnits)}
                    </td>
                    <td className="py-1 pr-3 text-end">
                      {formatCurrency(line.taxes, e.currencyCode, "en", e.minorUnits)}
                    </td>
                    <td className="py-1 text-end">
                      {formatCurrency(line.total, e.currencyCode, "en", e.minorUnits)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td colSpan={4} className="py-1.5 pr-3">
                  Estimated total
                </td>
                <td className="py-1.5 text-end tabular-nums">
                  {formatCurrency(e.total, e.currencyCode, "en", e.minorUnits)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
      {adding ? (
        <AddPackageDialog
          room={room}
          businessDate={businessDate}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function AddPackageDialog({
  room,
  businessDate,
  onClose,
}: {
  room: ReservationRoomDetail;
  businessDate: string | null;
  onClose: () => void;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const packages = usePackagesQuery(property.id, { skip: !can("rates:read") });
  const [add, state] = useAddReservationPackageMutation();
  const firstNight = businessDate && businessDate > room.arrival ? businessDate : room.arrival;
  const lastNight = addDays(room.departure, -1);
  const [packageId, setPackageId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [startDate, setStartDate] = useState(firstNight);
  const [endDate, setEndDate] = useState(lastNight);
  const error = toClientApiError(state.error);
  const sellable = (packages.data ?? []).filter((p) => p.status === "ACTIVE" && p.sellSeparately);

  return (
    <FormDialog
      title="Add package"
      description="Priced by the package's components and posted with the nightly room charge."
      onClose={onClose}
      onSubmit={async () => {
        const result = await add({
          propertyId: property.id,
          reservationRoomId: room.id,
          body: { packageId, quantity: Number.parseInt(quantity || "0", 10), startDate, endDate },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Add package"
      disabled={!packageId || !startDate || !endDate || Number.parseInt(quantity || "0", 10) < 1}
      pending={state.isLoading}
      error={error}
    >
      <Select
        label="Package"
        placeholder={
          packages.isLoading
            ? "Loading packages…"
            : sellable.length
              ? "Choose a package"
              : "No package is sold separately"
        }
        options={sellable.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
        value={packageId}
        onChange={(e) => setPackageId(e.target.value)}
        errors={error?.fieldErrors.packageId}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Quantity"
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/\D/g, "").slice(0, 2))}
        />
        <TextField
          label="First night"
          type="date"
          min={firstNight}
          max={lastNight}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          errors={error?.fieldErrors.startDate}
        />
        <TextField
          label="Last night"
          type="date"
          min={firstNight}
          max={lastNight}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          errors={error?.fieldErrors.endDate}
        />
      </div>
    </FormDialog>
  );
}
