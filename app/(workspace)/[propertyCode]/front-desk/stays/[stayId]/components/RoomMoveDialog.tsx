"use client";

import { useState } from "react";
import { RoomReadinessBadge } from "@/components/front-desk/RoomStatusBadges";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useMoveRoomMutation, useRoomOptionsQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate } from "@/lib/utils/format";
import type { StayDetail } from "@/modules/front-desk/front-desk.types";
import { READINESS_LABELS, isOverridableReadiness } from "@/modules/rooms/rooms.policy";

/**
 * In-house room move to another room of the booked type for the remaining
 * nights. The vacated room becomes vacant and dirty; the move is audited
 * with its reason.
 */
export function RoomMoveDialog({
  open,
  onClose,
  stay,
}: {
  open: boolean;
  onClose: () => void;
  stay: StayDetail;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const options = useRoomOptionsQuery(
    { propertyId: property.id, reservationRoomId: stay.reservationRoomId },
    { skip: !open },
  );
  const [roomId, setRoomId] = useState("");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [note, setNote] = useState("");
  const [acceptNotReady, setAcceptNotReady] = useState(false);
  const [move, { isLoading, error }] = useMoveRoomMutation();
  const apiError = toClientApiError(error);

  const selected = options.data?.find((o) => o.id === roomId) ?? null;
  const notReady = !!selected && selected.readiness !== "READY";
  const canOverride =
    notReady && isOverridableReadiness(selected.readiness) && can("rooms:update_status");
  const blocked =
    !roomId ||
    !reasonCodeId ||
    (notReady && !(canOverride && acceptNotReady && note.trim().length >= 3));

  async function submit() {
    const result = await move({
      propertyId: property.id,
      stayId: stay.id,
      body: {
        version: stay.version,
        roomId,
        reasonCodeId,
        ...(note.trim() ? { reason: note.trim() } : {}),
        ...(notReady ? { acceptNotReady: true } : {}),
      },
    });
    if ("data" in result) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change room"
      description={`${stay.guest.name} · now in room ${stay.room.number} · ${stay.roomType.code} until ${formatDate(stay.departure)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button pending={isLoading} disabled={blocked} onClick={() => void submit()}>
            Move guest
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <Select
          label="New room"
          placeholder={options.isLoading ? "Loading rooms…" : "Select a room"}
          options={(options.data ?? []).map((o) => ({
            value: o.id,
            label: `${o.number}${o.floor ? ` · ${o.floor}` : ""} · ${READINESS_LABELS[o.readiness]}`,
          }))}
          value={roomId}
          onChange={(e) => {
            setRoomId(e.target.value);
            setAcceptNotReady(false);
          }}
          hint={
            options.data
              ? `${options.data.length} ${stay.roomType.code} room(s) free for the remaining nights`
              : undefined
          }
        />
        {selected ? (
          <p className="flex items-center gap-2 text-sm">
            Room {selected.number}: <RoomReadinessBadge readiness={selected.readiness} />
          </p>
        ) : null}
        <Select
          label="Reason"
          placeholder="Select a reason"
          options={stay.reasonCodes.roomMove.map((r) => ({
            value: r.id,
            label: `${r.code} · ${r.name}`,
          }))}
          value={reasonCodeId}
          onChange={(e) => setReasonCodeId(e.target.value)}
        />
        {notReady && !canOverride ? (
          <Alert tone="warning">This room cannot take the guest now. Choose a ready room.</Alert>
        ) : null}
        {canOverride ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acceptNotReady}
              onChange={(e) => setAcceptNotReady(e.target.checked)}
            />
            Move into a room that is not ready (high-risk, note required)
          </label>
        ) : null}
        <TextArea
          label={notReady ? "Note (required)" : "Note (optional)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
        />
        <p className="text-xs text-fg-muted">
          Room {stay.room.number} becomes vacant and is marked for cleaning.
        </p>
      </div>
    </Dialog>
  );
}
