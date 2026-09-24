"use client";

import Link from "next/link";
import type { Route } from "next";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { AuditHistory } from "@/components/audit/AuditHistory";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useReservationQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";
import { ReservationRoomPanel } from "./ReservationRoomPanel";

export function ReservationDetailView({
  reservationId,
  justCreated,
}: {
  reservationId: string;
  justCreated: boolean;
}) {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const query = useReservationQuery(
    { propertyId: property.id, reservationId },
    { skip: !can("reservations:read") },
  );
  const error = toClientApiError(query.error);

  if (permissionsLoading) return <StatusPanel kind="loading" title="Loading reservation" />;
  if (!can("reservations:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the reservations:read permission."
      />
    );
  }
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading reservation" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={error?.code === "NOT_FOUND" ? "empty" : "error"}
        title={
          error?.code === "NOT_FOUND" ? "Reservation not found" : "Could not load the reservation"
        }
        description={error?.message}
        requestId={error?.requestId}
        action={
          error?.code === "NOT_FOUND" ? (
            <Link
              href={`/${property.code}/reservations` as Route}
              className="text-sm text-brand hover:underline"
            >
              Back to reservations
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

  const reservation = query.data;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <Link href={`/${property.code}/reservations` as Route} className="hover:underline">
          Reservations
        </Link>{" "}
        / {reservation.confirmationNumber}
      </nav>
      {/* Only until the first change: every command bumps the room version. */}
      {justCreated && reservation.rooms.every((room) => room.version === 1) ? (
        <Alert tone="success">Reservation {reservation.confirmationNumber} was created.</Alert>
      ) : null}
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="font-mono text-2xl font-semibold">{reservation.confirmationNumber}</h1>
        <p className="text-sm text-fg-secondary">
          {reservation.rooms.length > 1 ? `${reservation.rooms.length} rooms · ` : ""}
          Booked {formatDateTime(reservation.bookedAt, property.timezone)}
          {reservation.bookedBy ? ` by ${reservation.bookedBy}` : ""}
          {reservation.channel ? ` · ${reservation.channel.name}` : ""}
          {reservation.externalReference ? ` · Ref ${reservation.externalReference}` : ""}
        </p>
      </header>

      {reservation.rooms.map((room) => (
        <ReservationRoomPanel key={room.id} room={room} reservation={reservation} />
      ))}

      {reservation.notes.length > 0 ? (
        <section
          aria-labelledby="notes-heading"
          className="rounded-lg border border-border-subtle bg-surface p-4"
        >
          <h2 id="notes-heading" className="mb-2 text-lg font-semibold">
            Notes and special requests
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {reservation.notes.map((note) => (
              <li key={note.id}>
                <p>{note.body}</p>
                <p className="text-xs text-fg-muted">
                  {formatDateTime(note.createdAt, property.timezone)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AuditHistory entries={reservation.history} timezone={property.timezone} />
    </div>
  );
}
