"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useCheckInMutation, useRoomOptionsQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate, pluralize } from "@/lib/utils/format";
import type { StayDetail } from "@/modules/front-desk/front-desk.types";
import { READINESS_LABELS, isOverridableReadiness } from "@/modules/rooms/rooms.policy";
import { RoomReadinessBadge } from "./RoomStatusBadges";

export interface CheckInTarget {
  reservationRoomId: string;
  version: number;
  confirmation: string;
  guestName: string;
  roomType: { code: string; name: string };
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  room: { id: string; number: string } | null;
}

/**
 * Check-in: verify the guest and stay, confirm or choose the room (free for
 * the whole stay, with its readiness), then check in. The server re-checks
 * everything under lock; a room that is not clean needs an audited reason.
 */
export function CheckInDialog({
  open,
  onClose,
  target,
  onCheckedIn,
}: {
  open: boolean;
  onClose: () => void;
  target: CheckInTarget;
  onCheckedIn?: (stay: StayDetail) => void;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const options = useRoomOptionsQuery(
    { propertyId: property.id, reservationRoomId: target.reservationRoomId },
    { skip: !open },
  );
  const [roomId, setRoomId] = useState(target.room?.id ?? "");
  const [verified, setVerified] = useState(false);
  const [acceptNotReady, setAcceptNotReady] = useState(false);
  const [reason, setReason] = useState("");
  const [checkIn, { isLoading, error }] = useCheckInMutation();
  const apiError = toClientApiError(error);

  const canAssign = can("rooms:assign");
  const selected = options.data?.find((option) => option.id === roomId) ?? null;
  const readiness = selected?.readiness ?? null;
  const notReady = readiness !== null && readiness !== "READY";
  const canOverride = notReady && isOverridableReadiness(readiness) && can("rooms:update_status");
  const blocked =
    !roomId ||
    !verified ||
    (notReady && !(canOverride && acceptNotReady && reason.trim().length >= 3));

  async function submit() {
    const result = await checkIn({
      propertyId: property.id,
      reservationRoomId: target.reservationRoomId,
      body: {
        version: target.version,
        ...(roomId !== target.room?.id ? { roomId } : {}),
        ...(notReady ? { acceptNotReady: true, reason: reason.trim() } : {}),
      },
    });
    if ("data" in result && result.data) {
      onClose();
      onCheckedIn?.(result.data);
    }
  }

  const facts: [string, string][] = [
    ["Guest", target.guestName],
    ["Confirmation", target.confirmation],
    [
      "Stay",
      `${formatDate(target.arrival)} → ${formatDate(target.departure)} · ${pluralize(target.nights, "night")}`,
    ],
    [
      "Party",
      `${pluralize(target.adults, "adult")}${target.children ? `, ${pluralize(target.children, "child", "children")}` : ""}`,
    ],
    ["Room type", `${target.roomType.code} · ${target.roomType.name}`],
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Check in"
      size="lg"
      description="Verify the guest and the stay, confirm the room, then check in."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button pending={isLoading} disabled={blocked} onClick={() => void submit()}>
            Check in
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[9rem_1fr]">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-xs text-fg-muted sm:py-0.5">{term}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2">
          <Select
            label="Room"
            placeholder={options.isLoading ? "Loading rooms…" : "Select a room"}
            disabled={!canAssign && !!target.room}
            options={(options.data ?? []).map((option) => ({
              value: option.id,
              label: `${option.number}${option.floor ? ` · ${option.floor}` : ""} · ${READINESS_LABELS[option.readiness]}${option.isAccessible ? " · accessible" : ""}`,
            }))}
            value={roomId}
            onChange={(e) => {
              setRoomId(e.target.value);
              setAcceptNotReady(false);
            }}
            hint={
              options.data
                ? `${options.data.length} room(s) of this type free for the whole stay, ready rooms first`
                : undefined
            }
          />
          {target.room && options.data && !selected && roomId === target.room.id ? (
            <Alert tone="warning">
              The assigned room {target.room.number} is no longer free for this stay. Choose another
              room.
            </Alert>
          ) : null}
          {readiness ? (
            <p className="flex items-center gap-2 text-sm">
              Room {selected?.number}: <RoomReadinessBadge readiness={readiness} />
            </p>
          ) : null}
        </div>

        {notReady ? (
          canOverride ? (
            <fieldset className="flex flex-col gap-2 rounded-md border border-warning/40 p-3">
              <legend className="px-1 text-xs text-fg-secondary">Room not ready</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acceptNotReady}
                  onChange={(e) => setAcceptNotReady(e.target.checked)}
                />
                Check in anyway (recorded as a high-risk action)
              </label>
              {acceptNotReady ? (
                <TextArea
                  label="Reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              ) : null}
            </fieldset>
          ) : (
            <Alert tone="warning">
              This room cannot take the guest now. Choose a ready room
              {readiness === "OCCUPIED" ? " (the current guest has not checked out)" : ""}.
            </Alert>
          )
        ) : null}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          I have verified the guest&apos;s identity and the stay details with the guest.
        </label>
      </div>
    </Dialog>
  );
}
