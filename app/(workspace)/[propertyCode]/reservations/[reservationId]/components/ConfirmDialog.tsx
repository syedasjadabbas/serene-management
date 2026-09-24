"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useProperty } from "@/hooks/useProperty";
import {
  useBookingOptionsQuery,
  useConfirmReservationMutation,
} from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import type { ReservationRoomDetail } from "@/modules/reservations/reservations.types";

/** Tentative / waitlisted → confirmed: choose an inventory-deducting guarantee type. */
export function ConfirmDialog({
  open,
  onClose,
  room,
}: {
  open: boolean;
  onClose: () => void;
  room: ReservationRoomDetail;
}) {
  const property = useProperty();
  const options = useBookingOptionsQuery(property.id, { skip: !open });
  const deducting = options.data?.reservationTypes.filter((t) => t.deductsInventory) ?? [];
  const [typeId, setTypeId] = useState("");
  const [confirm, { isLoading, error }] = useConfirmReservationMutation();
  const apiError = toClientApiError(error);
  const selected = typeId || deducting.find((t) => t.isGuaranteed)?.id || "";

  async function submit() {
    const result = await confirm({
      propertyId: property.id,
      reservationRoomId: room.id,
      body: { version: room.version, reservationTypeId: selected },
    });
    if ("data" in result) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Confirm reservation"
      description={`${room.displayConfirmation} is ${room.bookingState.toLowerCase()}. Confirming deducts inventory for ${room.nights} night(s).`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button pending={isLoading} disabled={!selected} onClick={() => void submit()}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <Select
          label="Guarantee type"
          options={deducting.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))}
          value={selected}
          onChange={(e) => setTypeId(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
