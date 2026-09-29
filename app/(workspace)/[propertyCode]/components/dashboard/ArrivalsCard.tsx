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

  return (
    <Card
      title="Arrivals to check in"
      description="Guests due today who have not arrived yet"
      flush
      actions={
        <Link href={frontDesk} className={textLinkClass}>
          Open front desk
        </Link>
      }
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
              <li key={row.reservationRoomId} className="flex items-center gap-3 px-5 py-3">
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
      {items.length === LIMIT ? (
        <div className="border-t border-border-subtle px-5 py-3 text-sm">
          <Link href={frontDesk} className={textLinkClass}>
            See all pending arrivals
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
