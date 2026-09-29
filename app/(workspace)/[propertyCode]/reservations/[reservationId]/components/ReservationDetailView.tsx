"use client";

import Link from "next/link";
import type { Route } from "next";
import { BookingStateBadge } from "@/components/reservations/BookingStateBadge";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { type Fact, FactList } from "@/components/ui/FactList";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { AuditHistory } from "@/components/audit/AuditHistory";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useReservationQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate, formatDateTime, pluralize } from "@/lib/utils/format";
import { useState } from "react";
import { CompanyDialog } from "./CompanyDialog";
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
  const [editingCompany, setEditingCompany] = useState(false);

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
  const lead = reservation.rooms[0];
  const booking: Fact[] = [
    {
      label: "Booked",
      value: `${formatDateTime(reservation.bookedAt, property.timezone)}${
        reservation.bookedBy ? ` by ${reservation.bookedBy}` : ""
      }`,
      wide: true,
    },
    { label: "Channel", value: reservation.channel?.name ?? "Direct" },
    { label: "External reference", value: reservation.externalReference ?? "—" },
  ];
  if (reservation.company || reservation.actions.changeCompany) {
    booking.push({
      label: "Company",
      wide: true,
      value: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {reservation.company ? (
            <Link
              href={`/${property.code}/companies/${reservation.company.id}` as Route}
              className="font-medium text-brand hover:underline"
            >
              {reservation.company.name}
            </Link>
          ) : (
            <span className="text-fg-secondary">None</span>
          )}
          {reservation.company && reservation.booker ? (
            <span className="text-fg-secondary">· booked by {reservation.booker.fullName}</span>
          ) : null}
          {reservation.actions.changeCompany ? (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 md:min-h-0"
              onClick={() => setEditingCompany(true)}
            >
              {reservation.company ? "Change" : "Set company"}
            </Button>
          ) : null}
        </span>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Reservations", href: `/${property.code}/reservations` },
          { label: reservation.confirmationNumber },
        ]}
        title={lead ? lead.primaryGuest.name : reservation.confirmationNumber}
        meta={
          <>
            <span className="font-mono text-sm text-fg-secondary">
              #{reservation.confirmationNumber}
            </span>
            {reservation.rooms.length === 1 && lead ? (
              <BookingStateBadge state={lead.bookingState} />
            ) : (
              <Badge>{reservation.rooms.length} rooms</Badge>
            )}
          </>
        }
        description={
          lead
            ? `${formatDate(lead.arrival)} → ${formatDate(lead.departure)} · ${pluralize(lead.nights, "night")}`
            : undefined
        }
      />
      {/* Only until the first change: every command bumps the room version. */}
      {justCreated && reservation.rooms.every((room) => room.version === 1) ? (
        <Alert tone="success">Reservation {reservation.confirmationNumber} was created.</Alert>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          {reservation.rooms.map((room) => (
            <ReservationRoomPanel key={room.id} room={room} reservation={reservation} />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Booking">
            <FactList items={booking} />
          </Card>
          <Card
            title="Notes and special requests"
            description={reservation.notes.length === 0 ? "None recorded." : undefined}
          >
            {reservation.notes.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border-subtle text-sm">
                {reservation.notes.map((note) => (
                  <li key={note.id} className="py-2 first:pt-0 last:pb-0">
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {formatDateTime(note.createdAt, property.timezone)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>

      <AuditHistory entries={reservation.history} timezone={property.timezone} />
      {editingCompany ? (
        <CompanyDialog reservation={reservation} onClose={() => setEditingCompany(false)} />
      ) : null}
    </div>
  );
}
