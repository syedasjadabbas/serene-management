"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import {
  useBookingOptionsQuery,
  useUpdateReservationRoomMutation,
} from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import type { UpdateReservationRoomInput } from "@/modules/reservations/reservations.schema";
import type { ReservationRoomDetail } from "@/modules/reservations/reservations.types";

/**
 * Modify dates, party, room type, rate plan or ETA. Only changed fields are
 * sent; the server re-prices, re-checks availability and audits the diff.
 */
export function ModifyDialog({
  open,
  onClose,
  room,
  businessDate,
}: {
  open: boolean;
  onClose: () => void;
  room: ReservationRoomDetail;
  businessDate: string | null;
}) {
  const property = useProperty();
  const options = useBookingOptionsQuery(property.id, { skip: !open });
  const initial = {
    arrival: room.arrival,
    departure: room.departure,
    adults: String(room.adults),
    children: String(room.children),
    roomTypeId: room.roomType.id,
    ratePlanId: room.ratePlan.id,
    eta: room.eta ?? "",
  };
  const [values, setValues] = useState(initial);
  const [update, { isLoading, error }] = useUpdateReservationRoomMutation();
  const apiError = toClientApiError(error);
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const changes: Partial<UpdateReservationRoomInput> = {};
  if (values.arrival !== initial.arrival) changes.arrival = values.arrival;
  if (values.departure !== initial.departure) changes.departure = values.departure;
  if (values.adults !== initial.adults) changes.adults = Number(values.adults);
  if (values.children !== initial.children) changes.children = Number(values.children);
  if (values.roomTypeId !== initial.roomTypeId) changes.roomTypeId = values.roomTypeId;
  if (values.ratePlanId !== initial.ratePlanId) changes.ratePlanId = values.ratePlanId;
  if (values.eta !== initial.eta) changes.eta = values.eta || null;
  const hasChanges = Object.keys(changes).length > 0;

  async function submit() {
    const result = await update({
      propertyId: property.id,
      reservationRoomId: room.id,
      body: { version: room.version, ...changes },
    });
    if ("data" in result) onClose();
  }

  const fieldErrors = apiError?.fieldErrors ?? {};
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Modify reservation"
      description={`${room.displayConfirmation}. Changing the stay re-prices it and re-checks availability.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button pending={isLoading} disabled={!hasChanges} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TextField
            label="Arrival"
            type="date"
            min={businessDate ?? undefined}
            value={values.arrival}
            onChange={set("arrival")}
            errors={fieldErrors.arrival}
          />
          <TextField
            label="Departure"
            type="date"
            value={values.departure}
            onChange={set("departure")}
            errors={fieldErrors.departure}
          />
          <TextField
            label="Adults"
            type="number"
            min={1}
            max={12}
            value={values.adults}
            onChange={set("adults")}
          />
          <TextField
            label="Children"
            type="number"
            min={0}
            max={12}
            value={values.children}
            onChange={set("children")}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Room type"
            options={(options.data?.roomTypes ?? [room.roomType]).map((t) => ({
              value: t.id,
              label: `${t.code} · ${t.name}`,
            }))}
            value={values.roomTypeId}
            onChange={set("roomTypeId")}
            hint={
              room.room && values.roomTypeId !== initial.roomTypeId
                ? "The assigned room will be released"
                : undefined
            }
          />
          <Select
            label="Rate plan"
            options={(options.data?.ratePlans ?? [room.ratePlan]).map((p) => ({
              value: p.id,
              label: `${p.code} · ${p.name}`,
            }))}
            value={values.ratePlanId}
            onChange={set("ratePlanId")}
          />
          <TextField
            label="Expected arrival time"
            type="time"
            value={values.eta}
            onChange={set("eta")}
          />
        </div>
      </div>
    </Dialog>
  );
}
