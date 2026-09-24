"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useProperty } from "@/hooks/useProperty";
import {
  useAssignRoomMutation,
  useAvailableRoomsQuery,
} from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import type { ReservationRoomDetail } from "@/modules/reservations/reservations.types";

/** Assign / change / remove the physical room (free and in order for the whole stay). */
export function AssignRoomDialog({
  open,
  onClose,
  room,
}: {
  open: boolean;
  onClose: () => void;
  room: ReservationRoomDetail;
}) {
  const property = useProperty();
  const rooms = useAvailableRoomsQuery(
    {
      propertyId: property.id,
      roomTypeId: room.roomType.id,
      arrival: room.arrival,
      departure: room.departure,
      excludeReservationRoomId: room.id,
    },
    { skip: !open },
  );
  const [roomId, setRoomId] = useState(room.room?.id ?? "");
  const [assign, { isLoading, error }] = useAssignRoomMutation();
  const apiError = toClientApiError(error);

  async function submit(value: string | null) {
    const result = await assign({
      propertyId: property.id,
      reservationRoomId: room.id,
      body: { version: room.version, roomId: value },
    });
    if ("data" in result) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={room.room ? "Change room" : "Assign room"}
      description={`${room.displayConfirmation} · ${room.roomType.code} · ${room.arrival} → ${room.departure}`}
      footer={
        <>
          {room.room ? (
            <Button variant="ghost" pending={isLoading} onClick={() => void submit(null)}>
              Remove room
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            pending={isLoading}
            disabled={!roomId || roomId === room.room?.id}
            onClick={() => void submit(roomId)}
          >
            Assign
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <Select
          label="Room"
          placeholder={rooms.isLoading ? "Loading free rooms…" : "Select a room"}
          options={(rooms.data ?? []).map((r) => ({
            value: r.id,
            label: `${r.number}${r.floor ? ` · ${r.floor}` : ""} · ${r.housekeepingStatus.toLowerCase()}${r.isAccessible ? " · accessible" : ""}`,
          }))}
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          hint={rooms.data ? `${rooms.data.length} room(s) free for the whole stay` : undefined}
        />
      </div>
    </Dialog>
  );
}
