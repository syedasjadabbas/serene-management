"use client";

import { useState } from "react";
import { Button } from "@/global/components/ui/Button";
import { THead, Table, TableFrame, Td, Th } from "@/global/components/ui/Table";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { TextField } from "@/global/components/ui/TextField";
import { useController, type Control } from "react-hook-form";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";
import { usePackagesQuery } from "@/global/api/endpoints/ratesApi";
import {
  useAddReservationPackageMutation,
  useChargeEstimateQuery,
  useRemoveReservationPackageMutation,
} from "@/global/api/endpoints/reservationsApi";
import { toClientApiError } from "@/global/api/errors";
import { formatCurrency, formatDate, formatShortDate } from "@serene/shared/lib/utils/format";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import type { ReservationRoomDetail } from "@serene/shared/modules/reservations/reservations.types";
import {
  type AddPackageValues,
  addPackageBody,
  addPackageDefaults,
  addPackageFormSchema,
  sanitizeQuantity,
} from "../_lib/addPackageForm";

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
    <div className="flex flex-col gap-3 border-t border-border-subtle p-5">
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
                Qty {p.quantity} · {formatShortDate(p.startDate)} → {formatShortDate(p.endDate)}
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
        <TableFrame label="Estimated folio charges per night">
          <Table caption="Estimated folio charges per night" minWidth="32rem">
            <THead>
              <tr>
                <Th>Night</Th>
                <Th>Line</Th>
                <Th numeric>Net</Th>
                <Th numeric>Tax</Th>
                <Th numeric>Total</Th>
              </tr>
            </THead>
            <tbody className="tabular-nums">
              {e.nights.flatMap((night) =>
                night.lines.map((line, index) => (
                  <tr
                    key={`${night.date}-${index}`}
                    className={index === 0 ? "border-t border-border-subtle" : undefined}
                  >
                    <Td className="h-9 py-1.5 whitespace-nowrap">
                      {index === 0 ? (
                        <>
                          {formatDate(night.date)}
                          {night.posted ? (
                            <span className="ms-1 text-xs text-fg-muted">(posted)</span>
                          ) : null}
                        </>
                      ) : null}
                    </Td>
                    <Td className="h-9 py-1.5">
                      {line.description}
                      {line.quantity > 1 ? ` · qty ${line.quantity}` : ""}
                    </Td>
                    <Td numeric className="h-9 py-1.5">
                      {formatCurrency(line.net, e.currencyCode, "en", e.minorUnits)}
                    </Td>
                    <Td numeric className="h-9 py-1.5">
                      {formatCurrency(line.taxes, e.currencyCode, "en", e.minorUnits)}
                    </Td>
                    <Td numeric className="h-9 py-1.5">
                      {formatCurrency(line.total, e.currencyCode, "en", e.minorUnits)}
                    </Td>
                  </tr>
                )),
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td colSpan={4} className="px-3 py-2">
                  Estimated total
                </td>
                <td className="px-3 py-2 text-end tabular-nums">
                  {formatCurrency(e.total, e.currencyCode, "en", e.minorUnits)}
                </td>
              </tr>
            </tfoot>
          </Table>
        </TableFrame>
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
  const { control, handleSubmit, setError, formState } = useZodForm(
    addPackageFormSchema,
    addPackageDefaults(firstNight, lastNight),
  );
  const error = toClientApiError(state.error);
  const sellable = (packages.data ?? []).filter((p) => p.status === "ACTIVE" && p.sellSeparately);

  async function submit(values: AddPackageValues) {
    const result = await add({
      propertyId: property.id,
      reservationRoomId: room.id,
      body: addPackageBody(values),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title="Add package"
      description="Priced by the package's components and posted with the nightly room charge."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Add package"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormSelect
        control={control}
        name="packageId"
        label="Package"
        placeholder={
          packages.isLoading
            ? "Loading packages…"
            : sellable.length
              ? "Choose a package"
              : "No package is sold separately"
        }
        options={sellable.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <QuantityField control={control} />
        <FormTextField
          control={control}
          name="startDate"
          label="First night"
          type="date"
          min={firstNight}
          max={lastNight}
        />
        <FormTextField
          control={control}
          name="endDate"
          label="Last night"
          type="date"
          min={firstNight}
          max={lastNight}
        />
      </div>
    </FormDialog>
  );
}

function QuantityField({ control }: { control: Control<AddPackageValues> }) {
  const {
    field: { ref, value, onChange, onBlur },
    fieldState,
  } = useController({ control, name: "quantity" });
  return (
    <TextField
      ref={ref}
      label="Quantity"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(sanitizeQuantity(e.target.value))}
      onBlur={onBlur}
      errors={fieldState.error?.message ? [fieldState.error.message] : undefined}
    />
  );
}
