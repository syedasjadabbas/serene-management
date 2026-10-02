"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { ArrivalStateBadge } from "@/components/front-desk/RoomStatusBadges";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button, textLinkClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useArrivalsQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";

const LIMIT = 6;

/**
 * Arrivals still to check in on the business date (the front desk's own
 * "pending" list, first page). Rows open the reservation; the card links to
 * the front desk, where check-in happens. Requires frontdesk:read.
 *
 * On the dashboard the card is as tall as the room-status card beside it, so
 * it is laid out as a list panel: rows from the top, and a footer pinned to
 * the bottom edge with the count and the way to the front desk.
 */
export function ArrivalsCard({
  propertyId,
  propertyCode,
  canOpenReservation,
}: {
  propertyId: string;
  propertyCode: string;
  canOpenReservation: boolean;
}) {
  const query = useArrivalsQuery(
    { propertyId, filter: "pending", limit: String(LIMIT) },
    { pollingInterval: 120_000, skipPollingIfUnfocused: true },
  );
  const error = toClientApiError(query.error);
  const frontDesk = `/${propertyCode}/front-desk?view=arrivals&filter=pending` as Route;
  const items = query.data?.items ?? [];
  const more = Boolean(query.data?.meta.nextCursor);

  return (
    <Card
      title="Arrivals to check in"
      description="Guests due today who have not arrived yet"
      flush
      className="flex flex-col"
      bodyClassName="flex flex-1 flex-col"
    >
      {query.isLoading ? (
        <SkeletonRows rows={4} columns={4} label="Loading arrivals" />
      ) : error ? (
        <StatusPanel
          kind="error"
          title="Could not load arrivals"
          description={error.message}
          requestId={error.requestId}
          action={
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="Everyone has arrived"
          description="No arrivals are waiting to check in on this business date."
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {items.map((row) => {
            const name = <span className="truncate font-medium text-fg">{row.guest.name}</span>;
            return (
              <li key={row.reservationRoomId} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                <Avatar name={row.guest.name} tone={row.guest.vip ? "accent" : "brand"} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    {canOpenReservation ? (
                      <Link
                        href={`/${propertyCode}/reservations/${row.reservationId}` as Route}
                        className="inline-flex min-h-6 min-w-0 items-center hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                    {row.guest.vip ? <Badge tone="accent">VIP {row.guest.vip}</Badge> : null}
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-secondary">
                    <span className="font-mono">{row.confirmation}</span>
                    <span aria-hidden="true">·</span>
                    <span>{row.room ? `Room ${row.room.number}` : row.roomType.name}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {row.nights} {row.nights === 1 ? "night" : "nights"}
                    </span>
                    {row.eta ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock aria-hidden="true" className="size-3" />
                          ETA {row.eta}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="shrink-0">
                  <ArrivalStateBadge state={row.state} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border-subtle px-5 py-3 text-sm sm:px-6">
        <span className="text-fg-secondary">
          {query.data && items.length > 0
            ? more
              ? `First ${items.length} waiting to check in`
              : `${items.length} waiting to check in`
            : null}
        </span>
        <Link href={frontDesk} className={textLinkClass}>
          {more ? "See all pending arrivals" : "Open front desk"}
        </Link>
      </div>
    </Card>
  );
}
