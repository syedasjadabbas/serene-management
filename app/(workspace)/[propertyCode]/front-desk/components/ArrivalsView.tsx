"use client";

import Link from "next/link";
import type { Route } from "next";
import { type ReactNode, useState } from "react";
import { CheckInDialog, type CheckInTarget } from "@/components/front-desk/CheckInDialog";
import { ArrivalStateBadge, RoomReadinessBadge } from "@/components/front-desk/RoomStatusBadges";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useArrivalsQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatShortDate } from "@/lib/utils/format";
import type { ArrivalRow, StayDetail } from "@/modules/front-desk/front-desk.types";
import { POLL_MS } from "./constants";
import { useCursorPages } from "./useCursorPages";

const PAGE_SIZE = 50;
const COLUMNS = 9;

/** Due-in list for the business date, with inline check-in. */
export function ArrivalsView({ filter, q }: { filter: string; q: string }) {
  const property = useProperty();
  const { cursors, loadMore } = useCursorPages(`${filter}|${q}`);
  const [target, setTarget] = useState<CheckInTarget | null>(null);
  const [done, setDone] = useState<StayDetail | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {done ? (
        <Alert tone="success">
          {done.guest.name} is checked in to room {done.room.number}.{" "}
          <Link
            href={`/${property.code}/front-desk/stays/${done.id}` as Route}
            className="font-medium underline"
          >
            Open stay
          </Link>
        </Alert>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface">
        <table className="w-full min-w-[980px] text-sm">
          <caption className="sr-only">Arrivals for the business date</caption>
          <thead className="bg-surface-sunken text-left text-xs text-fg-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Guest
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Confirmation
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Stay
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                Guests
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Type
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Room
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                ETA
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {cursors.map((cursor, index) => (
            <ArrivalsPage
              key={cursor ?? "first"}
              filter={filter}
              q={q}
              cursor={cursor}
              isLast={index === cursors.length - 1}
              onLoadMore={loadMore}
              onCheckIn={(row) => {
                setDone(null);
                setTarget(toTarget(row));
              }}
            />
          ))}
        </table>
      </div>
      {target ? (
        <CheckInDialog
          key={`${target.reservationRoomId}-${target.version}`}
          open
          target={target}
          onClose={() => setTarget(null)}
          onCheckedIn={setDone}
        />
      ) : null}
    </div>
  );
}

function toTarget(row: ArrivalRow): CheckInTarget {
  return {
    reservationRoomId: row.reservationRoomId,
    version: row.version,
    confirmation: row.confirmation,
    guestName: row.guest.name,
    roomType: { code: row.roomType.code, name: row.roomType.name },
    arrival: row.arrival,
    departure: row.departure,
    nights: row.nights,
    adults: row.adults,
    children: row.children,
    room: row.room ? { id: row.room.id, number: row.room.number } : null,
  };
}

function ArrivalsPage({
  filter,
  q,
  cursor,
  isLast,
  onLoadMore,
  onCheckIn,
}: {
  filter: string;
  q: string;
  cursor: string | undefined;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
  onCheckIn: (row: ArrivalRow) => void;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const { data, isLoading, isFetching, error, refetch } = useArrivalsQuery(
    { propertyId: property.id, filter, q: q || undefined, cursor, limit: String(PAGE_SIZE) },
    { pollingInterval: cursor ? 0 : POLL_MS, skipPollingIfUnfocused: true },
  );
  const apiError = toClientApiError(error);

  if (isLoading) return <MessageRow>{<Spinner label="Loading arrivals" />}</MessageRow>;
  if (apiError) {
    return (
      <MessageRow tone="danger">
        {apiError.message}{" "}
        <Button size="sm" variant="secondary" onClick={() => void refetch()}>
          Retry
        </Button>
      </MessageRow>
    );
  }
  if (!data || (data.items.length === 0 && !cursor)) {
    return (
      <MessageRow>
        {q || filter !== "all" ? "No arrivals match." : "No arrivals for the business date."}
      </MessageRow>
    );
  }

  const canCheckIn = can("frontdesk:checkin");
  return (
    <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
      {data.items.map((row) => (
        <tr key={row.reservationRoomId} className="align-top hover:bg-surface-sunken/60">
          <td className="px-3 py-2">
            <span className="font-medium">{row.guest.name}</span>
            {row.guest.vip ? (
              <span className="ms-1 text-2xs font-semibold text-accent">VIP {row.guest.vip}</span>
            ) : null}
            {row.isWalkIn ? <span className="ms-1 text-2xs text-fg-muted">walk-in</span> : null}
            {row.latestNote ? (
              <p
                className="mt-0.5 line-clamp-1 max-w-64 text-xs text-fg-muted"
                title={row.latestNote}
              >
                {row.latestNote}
              </p>
            ) : null}
          </td>
          <td className="px-2 py-2">
            <Link
              href={`/${property.code}/reservations/${row.reservationId}` as Route}
              className="font-mono text-sm text-brand hover:underline"
            >
              {row.confirmation}
            </Link>
          </td>
          <td className="px-2 py-2 whitespace-nowrap">
            {formatShortDate(row.arrival)} → {formatShortDate(row.departure)}
            <span className="ms-1 text-xs text-fg-muted">{row.nights}n</span>
          </td>
          <td className="px-2 py-2 text-end tabular-nums">
            {row.adults}
            {row.children ? `+${row.children}` : ""}
          </td>
          <td className="px-2 py-2 font-mono text-xs">{row.roomType.code}</td>
          <td className="px-2 py-2">
            {row.room ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-sm">{row.room.number}</span>
                {row.state !== "CHECKED_IN" ? (
                  <RoomReadinessBadge readiness={row.room.readiness} />
                ) : null}
              </span>
            ) : (
              <span className="text-fg-muted">—</span>
            )}
          </td>
          <td className="px-2 py-2 tabular-nums">{row.eta ?? "—"}</td>
          <td className="px-2 py-2">
            <ArrivalStateBadge state={row.state} />
          </td>
          <td className="px-3 py-2 text-end whitespace-nowrap">
            {row.stayId ? (
              <Link
                href={`/${property.code}/front-desk/stays/${row.stayId}` as Route}
                className="text-sm text-brand hover:underline"
              >
                Open stay
              </Link>
            ) : row.state === "NEEDS_CONFIRMATION" ? (
              <Link
                href={`/${property.code}/reservations/${row.reservationId}` as Route}
                className="text-sm text-brand hover:underline"
              >
                Confirm first
              </Link>
            ) : canCheckIn ? (
              <Button size="sm" onClick={() => onCheckIn(row)}>
                Check in
              </Button>
            ) : null}
          </td>
        </tr>
      ))}
      {isLast && data.meta.nextCursor ? (
        <tr>
          <td colSpan={COLUMNS} className="px-3 py-2 text-center">
            <Button
              variant="secondary"
              size="sm"
              pending={isFetching}
              onClick={() => onLoadMore(data.meta.nextCursor!)}
            >
              Load more
            </Button>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

function MessageRow({ children, tone }: { children: ReactNode; tone?: "danger" }) {
  return (
    <tbody>
      <tr>
        <td
          colSpan={COLUMNS}
          className={`px-3 py-8 text-center text-sm ${tone === "danger" ? "text-danger" : "text-fg-secondary"}`}
        >
          {children}
        </td>
      </tr>
    </tbody>
  );
}
