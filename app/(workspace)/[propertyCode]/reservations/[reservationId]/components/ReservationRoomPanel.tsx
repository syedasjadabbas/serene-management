"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckInDialog } from "@/components/front-desk/CheckInDialog";
import { GuestRecognition } from "@/components/guests/GuestRecognition";
import { BookingStateBadge } from "@/components/reservations/BookingStateBadge";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDate, formatDateTime, pluralize } from "@/lib/utils/format";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import type {
  ReservationDetail,
  ReservationRoomDetail,
} from "@/modules/reservations/reservations.types";
import { AssignRoomDialog } from "./AssignRoomDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModifyDialog } from "./ModifyDialog";
import { ReasonDialog } from "./ReasonDialog";
import { RoomPackagesPanel } from "./RoomPackagesPanel";

type DialogName =
  | "modify"
  | "confirm"
  | "cancel"
  | "noShow"
  | "reinstate"
  | "reinstateNoShow"
  | "assign"
  | "checkIn"
  | null;

/** One reservation room: facts, nightly rates and the actions the server allows. */
export function ReservationRoomPanel({
  room,
  reservation,
}: {
  room: ReservationRoomDetail;
  reservation: ReservationDetail;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogName>(null);
  const close = () => setDialog(null);
  const actions = room.allowedActions;

  const facts: [string, string][] = [
    ["Guest", `${room.primaryGuest.name} (${room.primaryGuest.profileNumber})`],
    [
      "Contact",
      [room.primaryGuest.email, room.primaryGuest.phone].filter(Boolean).join(" · ") || "—",
    ],
    [
      "Stay",
      `${formatDate(room.arrival)} → ${formatDate(room.departure)} · ${pluralize(room.nights, "night")}`,
    ],
    [
      "Occupancy",
      `${pluralize(room.adults, "adult")}${room.children ? `, ${pluralize(room.children, "child", "children")}` : ""}`,
    ],
    ["Room type", `${room.roomType.code} · ${room.roomType.name}`],
    ["Room", room.room ? room.room.number : "Not assigned"],
    ["Rate plan", `${room.ratePlan.code} · ${room.ratePlan.name}`],
    ["Guarantee", `${room.reservationType.code} · ${room.reservationType.name}`],
    ["Market / source", `${room.marketCode.code} / ${room.sourceCode.code}`],
    ["Expected arrival", room.eta ?? "—"],
    ["Cancellation policy", room.cancellationPolicy ? `${room.cancellationPolicy.name}` : "—"],
    ["Stay total", formatCurrency(room.totalAmount, room.currencyCode)],
  ];

  return (
    <section
      aria-labelledby={`room-${room.id}`}
      className="rounded-lg border border-border-subtle bg-surface"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <h2 id={`room-${room.id}`} className="font-mono text-base font-semibold">
          {room.displayConfirmation}
        </h2>
        <BookingStateBadge state={room.bookingState} />
        <div className="ms-auto flex flex-wrap gap-1.5">
          {room.stay ? (
            <Link
              href={`/${property.code}/front-desk/stays/${room.stay.id}` as Route}
              className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs hover:bg-surface-sunken"
            >
              Open stay
            </Link>
          ) : null}
          {actions.checkIn ? (
            <Button size="sm" onClick={() => setDialog("checkIn")}>
              Check in
            </Button>
          ) : null}
          {actions.modify ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("modify")}>
              Modify
            </Button>
          ) : null}
          {actions.assignRoom ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("assign")}>
              {room.room ? "Change room" : "Assign room"}
            </Button>
          ) : null}
          {actions.confirm ? (
            <Button size="sm" onClick={() => setDialog("confirm")}>
              Confirm
            </Button>
          ) : null}
          {actions.reinstate ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("reinstate")}>
              Reinstate
            </Button>
          ) : null}
          {actions.reinstateNoShow ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("reinstateNoShow")}>
              Reinstate no-show
            </Button>
          ) : null}
          {actions.noShow ? (
            <Button size="sm" variant="danger" onClick={() => setDialog("noShow")}>
              No-show
            </Button>
          ) : null}
          {actions.cancel ? (
            <Button size="sm" variant="danger" onClick={() => setDialog("cancel")}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      {can("guests:read") ? (
        <div className="px-4 pt-3">
          <GuestRecognition guestId={room.primaryGuest.id} propertyCode={property.code} />
        </div>
      ) : null}
      <div className="grid gap-4 p-4 lg:grid-cols-[3fr_2fr]">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[10rem_1fr]">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-xs text-fg-muted sm:py-0.5">{term}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
          {room.cancellation ? (
            <div className="contents">
              <dt className="text-xs text-fg-muted sm:py-0.5">Cancelled</dt>
              <dd className="text-sm text-danger">
                {room.cancellation.number} ·{" "}
                {formatDateTime(room.cancellation.at, property.timezone)}
                {room.cancellation.reason ? ` · ${room.cancellation.reason.name}` : ""}
              </dd>
            </div>
          ) : null}
          {room.group ? (
            <div className="contents">
              <dt className="text-xs text-fg-muted sm:py-0.5">Group block</dt>
              <dd className="text-sm">
                <Link
                  href={`/${property.code}/groups/${room.group.id}` as Route}
                  className="text-brand hover:underline"
                >
                  {room.group.code} · {room.group.name}
                </Link>{" "}
                · {room.group.blockCode}
              </dd>
            </div>
          ) : null}
          {room.noShowAt ? (
            <div className="contents">
              <dt className="text-xs text-fg-muted sm:py-0.5">No-show</dt>
              <dd className="text-sm text-danger">
                {formatDateTime(room.noShowAt, property.timezone)}
              </dd>
            </div>
          ) : null}
        </dl>
        <table className="h-fit w-full text-sm">
          <caption className="mb-1 text-left text-xs text-fg-muted">Nightly rates</caption>
          <thead className="text-left text-xs text-fg-secondary">
            <tr>
              <th scope="col" className="py-1 font-medium">
                Night
              </th>
              <th scope="col" className="py-1 font-medium">
                Type / rate
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {room.nightly.map((night) => (
              <tr key={night.date}>
                <td className="py-1 whitespace-nowrap">{formatDate(night.date)}</td>
                <td className="py-1 font-mono text-xs">
                  {night.roomTypeCode} / {night.ratePlanCode}
                </td>
                <td className="py-1 text-end tabular-nums">
                  {formatCurrency(night.amount, room.currencyCode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RoomPackagesPanel room={room} businessDate={reservation.businessDate} />

      <ModifyDialog
        key={`m${room.version}`}
        open={dialog === "modify"}
        onClose={close}
        room={room}
        businessDate={reservation.businessDate}
      />
      <ConfirmDialog
        key={`c${room.version}`}
        open={dialog === "confirm"}
        onClose={close}
        room={room}
      />
      <AssignRoomDialog
        key={`a${room.version}`}
        open={dialog === "assign"}
        onClose={close}
        room={room}
      />
      <ReasonDialog
        key={`x${room.version}`}
        open={dialog === "cancel"}
        onClose={close}
        room={room}
        action="cancel"
      />
      <ReasonDialog
        key={`n${room.version}`}
        open={dialog === "noShow"}
        onClose={close}
        room={room}
        action="noShow"
      />
      <ReasonDialog
        key={`r${room.version}`}
        open={dialog === "reinstate"}
        onClose={close}
        room={room}
        action="reinstate"
      />
      <ReasonDialog
        key={`s${room.version}`}
        open={dialog === "reinstateNoShow"}
        onClose={close}
        room={room}
        action="reinstateNoShow"
      />
      {actions.checkIn ? (
        <CheckInDialog
          key={`i${room.version}`}
          open={dialog === "checkIn"}
          onClose={close}
          target={{
            reservationRoomId: room.id,
            version: room.version,
            confirmation: room.displayConfirmation,
            guestName: room.primaryGuest.name,
            roomType: room.roomType,
            arrival: room.arrival,
            departure: room.departure,
            nights: room.nights,
            adults: room.adults,
            children: room.children,
            room: room.room,
          }}
          onCheckedIn={(stay) =>
            router.push(`/${property.code}/front-desk/stays/${stay.id}?checkedIn=1` as Route)
          }
        />
      ) : null}
    </section>
  );
}
