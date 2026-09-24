"use client";

import { useState } from "react";
import { BookingStateBadge } from "@/components/reservations/BookingStateBadge";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDate, formatDateTime, pluralize } from "@/lib/utils/format";
import { useProperty } from "@/hooks/useProperty";
import type {
  ReservationDetail,
  ReservationRoomDetail,
} from "@/modules/reservations/reservations.types";
import { AssignRoomDialog } from "./AssignRoomDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModifyDialog } from "./ModifyDialog";
import { ReasonDialog } from "./ReasonDialog";

type DialogName = "modify" | "confirm" | "cancel" | "noShow" | "reinstate" | "assign" | null;

/** One reservation room: facts, nightly rates and the actions the server allows. */
export function ReservationRoomPanel({
  room,
  reservation,
}: {
  room: ReservationRoomDetail;
  reservation: ReservationDetail;
}) {
  const property = useProperty();
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
    </section>
  );
}
