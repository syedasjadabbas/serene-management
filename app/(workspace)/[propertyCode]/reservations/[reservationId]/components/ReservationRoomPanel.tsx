"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { CheckInDialog } from "@/components/front-desk/CheckInDialog";
import { GuestRecognition } from "@/components/guests/GuestRecognition";
import { BookingStateBadge } from "@/components/reservations/BookingStateBadge";
import { BedDouble, LogIn, Pencil, XCircle } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button, buttonClass } from "@/components/ui/Button";
import { type Fact, FactList } from "@/components/ui/FactList";
import { TBody, THead, Table, TableFrame, Td, Th, Tr } from "@/components/ui/Table";
import { formatCurrency, formatDateTime, formatShortDate } from "@/lib/utils/format";
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

  const facts: Fact[] = [
    { label: "Room type", value: `${room.roomType.code} · ${room.roomType.name}` },
    { label: "Rate plan", value: `${room.ratePlan.code} · ${room.ratePlan.name}` },
    { label: "Guarantee", value: `${room.reservationType.code} · ${room.reservationType.name}` },
    { label: "Market / source", value: `${room.marketCode.code} / ${room.sourceCode.code}` },
    { label: "Expected arrival", value: room.eta ?? "—" },
    { label: "Cancellation policy", value: room.cancellationPolicy?.name ?? "—" },
  ];
  if (room.group) {
    facts.push({
      label: "Group block",
      value: (
        <>
          <Link
            href={`/${property.code}/groups/${room.group.id}` as Route}
            className="text-brand hover:underline"
          >
            {room.group.code} · {room.group.name}
          </Link>{" "}
          · {room.group.blockCode}
        </>
      ),
    });
  }
  if (room.cancellation) {
    facts.push({
      label: "Cancelled",
      wide: true,
      value: (
        <span className="text-danger">
          {room.cancellation.number} · {formatDateTime(room.cancellation.at, property.timezone)}
          {room.cancellation.reason ? ` · ${room.cancellation.reason.name}` : ""}
        </span>
      ),
    });
  }
  if (room.noShowAt) {
    facts.push({
      label: "No-show",
      value: (
        <span className="text-danger">{formatDateTime(room.noShowAt, property.timezone)}</span>
      ),
    });
  }
  const stay: [string, ReactNode][] = [
    ["Arrival", formatShortDate(room.arrival)],
    ["Departure", formatShortDate(room.departure)],
    ["Nights", room.nights],
    ["Guests", `${room.adults}${room.children ? ` + ${room.children}` : ""}`],
    ["Room", room.room ? room.room.number : "Unassigned"],
    ["Stay total", formatCurrency(room.totalAmount, room.currencyCode)],
  ];

  return (
    <section
      aria-labelledby={`room-${room.id}`}
      className="min-w-0 rounded-lg border border-border-subtle bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        <h2 id={`room-${room.id}`} className="font-mono text-lg font-semibold">
          {room.displayConfirmation}
        </h2>
        <BookingStateBadge state={room.bookingState} />
        <div className="flex w-full flex-wrap gap-2 sm:ms-auto sm:w-auto">
          {actions.checkIn ? (
            <Button size="sm" onClick={() => setDialog("checkIn")}>
              <LogIn aria-hidden="true" className="size-3.5" />
              Check in
            </Button>
          ) : null}
          {actions.confirm ? (
            <Button size="sm" onClick={() => setDialog("confirm")}>
              Confirm
            </Button>
          ) : null}
          {room.stay ? (
            <Link
              href={`/${property.code}/front-desk/stays/${room.stay.id}` as Route}
              className={buttonClass("secondary", "sm")}
            >
              Open stay
            </Link>
          ) : null}
          {actions.modify ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("modify")}>
              <Pencil aria-hidden="true" className="size-3.5" />
              Modify
            </Button>
          ) : null}
          {actions.assignRoom ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("assign")}>
              <BedDouble aria-hidden="true" className="size-3.5" />
              {room.room ? "Change room" : "Assign room"}
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
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => setDialog("noShow")}
            >
              No-show
            </Button>
          ) : null}
          {actions.cancel ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => setDialog("cancel")}
            >
              <XCircle aria-hidden="true" className="size-3.5" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="mx-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-subtle bg-border-subtle sm:grid-cols-3 xl:grid-cols-6">
        {stay.map(([label, value]) => (
          <div key={label} className="bg-surface-sunken px-3 py-2">
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-start gap-3 px-5 pt-4">
        <Avatar name={room.primaryGuest.name} />
        <div className="min-w-0 flex-1">
          {can("guests:read") ? (
            <GuestRecognition guestId={room.primaryGuest.id} propertyCode={property.code} />
          ) : (
            <p className="font-medium">{room.primaryGuest.name}</p>
          )}
          <p className="mt-0.5 text-xs text-fg-secondary">
            <span className="font-mono">{room.primaryGuest.profileNumber}</span>
            {[room.primaryGuest.email, room.primaryGuest.phone]
              .filter(Boolean)
              .map((contact) => ` · ${contact}`)
              .join("")}
          </p>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[3fr_2fr]">
        <FactList items={facts} />
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold">Nightly rates</h3>
          <TableFrame label={`Nightly rates for ${room.displayConfirmation}`}>
            <Table caption={`Nightly rates for ${room.displayConfirmation}`}>
              <THead>
                <tr>
                  <Th>Night</Th>
                  <Th>Type / rate</Th>
                  <Th numeric>Amount</Th>
                </tr>
              </THead>
              <TBody>
                {room.nightly.map((night) => (
                  <Tr key={night.date}>
                    <Td className="h-9 py-1.5 whitespace-nowrap">{formatShortDate(night.date)}</Td>
                    <Td className="h-9 py-1.5 font-mono text-xs">
                      {night.roomTypeCode} / {night.ratePlanCode}
                    </Td>
                    <Td numeric className="h-9 py-1.5">
                      {formatCurrency(night.amount, room.currencyCode)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        </div>
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
