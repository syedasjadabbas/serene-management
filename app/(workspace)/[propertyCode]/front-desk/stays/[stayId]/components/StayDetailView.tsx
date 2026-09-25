"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { AuditHistory } from "@/components/audit/AuditHistory";
import { GuestRecognition } from "@/components/guests/GuestRecognition";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useStayQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, formatDateTime, pluralize } from "@/lib/utils/format";
import { CheckOutDialog } from "../../../components/CheckOutDialog";
import { ExtendStayDialog } from "./ExtendStayDialog";
import { RoomMoveDialog } from "./RoomMoveDialog";

const KIND_LABELS: Record<string, string> = {
  INITIAL: "Assigned",
  MOVE: "Moved",
  UPGRADE: "Upgrade",
  DOWNGRADE: "Downgrade",
  SWAP: "Swap",
  SHARE: "Share",
};

const TIMING_LABELS: Record<string, string> = {
  ON_TIME: "Due out today",
  OVERSTAY: "Past booked departure",
  EARLY: "Staying on",
  SAME_DAY: "Arrived today",
};

/** One stay: guest, room, lifecycle timestamps, room history and actions the server allows. */
export function StayDetailView({
  stayId,
  justCheckedIn,
}: {
  stayId: string;
  justCheckedIn: boolean;
}) {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const allowed = can("frontdesk:read");
  const query = useStayQuery({ propertyId: property.id, stayId }, { skip: !allowed });
  const error = toClientApiError(query.error);
  const [dialog, setDialog] = useState<"move" | "checkOut" | "extend" | null>(null);

  if (permissionsLoading) return <StatusPanel kind="loading" title="Loading stay" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the frontdesk:read permission."
      />
    );
  }
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading stay" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={error?.code === "NOT_FOUND" ? "empty" : "error"}
        title={error?.code === "NOT_FOUND" ? "Stay not found" : "Could not load the stay"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          error?.code === "NOT_FOUND" ? (
            <Link
              href={`/${property.code}/front-desk` as Route}
              className="text-sm text-brand hover:underline"
            >
              Back to the front desk
            </Link>
          ) : (
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          )
        }
      />
    );
  }

  const stay = query.data;
  const inHouse = stay.status === "IN_HOUSE";
  const facts: [string, string][] = [
    ["Guest", `${stay.guest.name} (${stay.guest.profileNumber})`],
    ["Contact", [stay.guest.email, stay.guest.phone].filter(Boolean).join(" · ") || "—"],
    [
      "Room",
      `${stay.room.number} · ${stay.room.frontOfficeStatus.toLowerCase()} · housekeeping ${stay.room.housekeepingStatus.toLowerCase()}`,
    ],
    ["Room type", `${stay.roomType.code} · ${stay.roomType.name}`],
    [
      "Stay",
      `${formatDate(stay.arrival)} → ${formatDate(stay.departure)} · ${pluralize(stay.nights, "night")}`,
    ],
    [
      "Party",
      `${pluralize(stay.adults, "adult")}${stay.children ? `, ${pluralize(stay.children, "child", "children")}` : ""}`,
    ],
    ["Rate plan", `${stay.ratePlan.code} · ${stay.ratePlan.name}`],
    ...(stay.allowedActions.viewFolio
      ? ([
          [
            "Balance",
            stay.folio
              ? `${formatCurrency(stay.folio.balance, stay.folio.currencyCode, "en", stay.folio.minorUnits)} · ${pluralize(stay.folio.windows, "window")}${stay.folio.status === "SETTLED" ? " · settled" : ""}`
              : "No folio yet",
          ],
        ] as [string, string][])
      : []),
    [
      "Checked in",
      `${formatDateTime(stay.checkedInAt, property.timezone)}${stay.checkedInBy ? ` by ${stay.checkedInBy}` : ""} · business date ${formatDate(stay.arrivalBusinessDate)}`,
    ],
    [
      "Checked out",
      stay.checkedOutAt
        ? `${formatDateTime(stay.checkedOutAt, property.timezone)}${stay.checkedOutBy ? ` by ${stay.checkedOutBy}` : ""} · business date ${formatDate(stay.departureBusinessDate)}`
        : "—",
    ],
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <Link href={`/${property.code}/front-desk` as Route} className="hover:underline">
          Front desk
        </Link>{" "}
        /{" "}
        <Link
          href={`/${property.code}/reservations/${stay.reservationId}` as Route}
          className="hover:underline"
        >
          {stay.confirmation}
        </Link>{" "}
        / Stay
      </nav>
      {justCheckedIn && inHouse && stay.version === 1 ? (
        <Alert tone="success">
          {stay.guest.name} is checked in to room {stay.room.number}.
        </Alert>
      ) : null}

      <section
        aria-labelledby="stay-heading"
        className="rounded-lg border border-border-subtle bg-surface"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <h1 id="stay-heading" className="text-lg font-semibold">
            {stay.guest.name}
          </h1>
          {stay.guest.vip ? <Badge tone="brand">VIP {stay.guest.vip}</Badge> : null}
          <Badge tone={inHouse ? "success" : "neutral"}>
            {inHouse ? "In house" : "Checked out"}
          </Badge>
          {stay.checkoutTiming ? (
            <span className="text-xs text-fg-muted">{TIMING_LABELS[stay.checkoutTiming]}</span>
          ) : null}
          {stay.isWalkIn ? <Badge>Walk-in</Badge> : null}
          <div className="ms-auto flex flex-wrap gap-1.5">
            {stay.allowedActions.viewFolio ? (
              <Link
                href={`/${property.code}/billing/${stay.reservationRoomId}` as Route}
                className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-xs hover:bg-surface-sunken"
              >
                Folio
              </Link>
            ) : null}
            {stay.allowedActions.extend ? (
              <Button size="sm" variant="secondary" onClick={() => setDialog("extend")}>
                Extend stay
              </Button>
            ) : null}
            {stay.allowedActions.moveRoom ? (
              <Button size="sm" variant="secondary" onClick={() => setDialog("move")}>
                Change room
              </Button>
            ) : null}
            {stay.allowedActions.checkOut ? (
              <Button size="sm" onClick={() => setDialog("checkOut")}>
                Check out
              </Button>
            ) : null}
          </div>
        </div>
        {can("guests:read") ? (
          <div className="px-4 pt-3">
            <GuestRecognition guestId={stay.guest.id} propertyCode={property.code} />
          </div>
        ) : null}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 p-4 sm:grid-cols-[10rem_1fr]">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-xs text-fg-muted sm:py-0.5">{term}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="rooms-heading"
          className="rounded-lg border border-border-subtle bg-surface p-4"
        >
          <h2 id="rooms-heading" className="mb-2 text-lg font-semibold">
            Room history
          </h2>
          <ol className="flex flex-col divide-y divide-border-subtle text-sm">
            {stay.assignments.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">Room {a.roomNumber}</span>
                  <span className="text-xs text-fg-secondary">
                    {formatDate(a.from)} → {formatDate(a.to)}
                  </span>
                  <Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>
                    {a.status === "ACTIVE" ? "Current" : "Ended"}
                  </Badge>
                </div>
                <p className="text-xs text-fg-muted">
                  {KIND_LABELS[a.kind] ?? a.kind} {formatDateTime(a.assignedAt, property.timezone)}
                  {a.assignedBy ? ` by ${a.assignedBy}` : ""}
                  {a.reason ? ` · ${a.reason.name}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="status-heading"
          className="rounded-lg border border-border-subtle bg-surface p-4"
        >
          <h2 id="status-heading" className="mb-2 text-lg font-semibold">
            Room status changes
          </h2>
          {stay.roomStatusChanges.length === 0 ? (
            <p className="text-sm text-fg-secondary">No changes recorded during this stay.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border-subtle text-sm">
              {stay.roomStatusChanges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                  <span className="font-mono">Room {c.roomNumber}</span>
                  <span>
                    {c.field === "FRONT_OFFICE" ? "occupancy" : "housekeeping"}{" "}
                    {c.from?.toLowerCase()} → {c.to?.toLowerCase()}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {c.source.toLowerCase().replace("_", " ")} ·{" "}
                    {formatDateTime(c.at, property.timezone)}
                    {c.by ? ` · ${c.by}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {stay.notes.length > 0 ? (
        <section
          aria-labelledby="stay-notes-heading"
          className="rounded-lg border border-border-subtle bg-surface p-4"
        >
          <h2 id="stay-notes-heading" className="mb-2 text-lg font-semibold">
            Notes and special requests
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {stay.notes.map((note) => (
              <li key={note.id}>{note.body}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <AuditHistory entries={stay.history} timezone={property.timezone} />

      {stay.allowedActions.moveRoom ? (
        <RoomMoveDialog
          key={`m${stay.version}`}
          open={dialog === "move"}
          onClose={() => setDialog(null)}
          stay={stay}
        />
      ) : null}
      {dialog === "checkOut" ? (
        <CheckOutDialog open stayId={stay.id} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "extend" ? (
        <ExtendStayDialog key={`e${stay.version}`} stay={stay} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
