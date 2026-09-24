"use client";

import Link from "next/link";
import type { Route } from "next";
import { RoomBoardStatusBadge } from "@/components/front-desk/RoomStatusBadges";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useRoomBoardQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatShortDate } from "@/lib/utils/format";
import type { RoomBoardRow } from "@/modules/front-desk/front-desk.types";
import { POLL_MS } from "./constants";

const EDGE: Record<RoomBoardRow["status"], string> = {
  OUT_OF_ORDER: "border-s-danger",
  OCCUPIED: "border-s-info",
  VACANT_READY: "border-s-success",
  VACANT_NOT_READY: "border-s-warning",
};

/**
 * Room board: every active room with occupancy and readiness for the
 * business date, the guest in house and today's assigned arrival.
 * Cleaning workflows belong to housekeeping (Phase 4).
 */
export function RoomBoardView({ filter }: { filter: string }) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const board = useRoomBoardQuery(
    { propertyId: property.id, filter },
    { skip: !can("rooms:read"), pollingInterval: POLL_MS, skipPollingIfUnfocused: true },
  );
  const error = toClientApiError(board.error);

  if (!can("rooms:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the rooms:read permission."
      />
    );
  }
  if (board.isLoading) return <StatusPanel kind="loading" title="Loading rooms" />;
  if (error) {
    return (
      <StatusPanel
        kind="error"
        title="Could not load rooms"
        description={error.message}
        requestId={error.requestId}
        action={
          <Button variant="secondary" onClick={() => void board.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  const rooms = board.data ?? [];
  if (rooms.length === 0) {
    return <StatusPanel kind="empty" title="No rooms match this filter" />;
  }

  return (
    <ul
      aria-label="Rooms"
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {rooms.map((room) => (
        <li
          key={room.id}
          className={cn(
            "flex flex-col gap-1 rounded-md border border-s-4 border-border-subtle bg-surface px-3 py-2",
            EDGE[room.status],
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-base font-semibold">{room.number}</span>
            <RoomBoardStatusBadge status={room.status} />
          </div>
          <p className="text-xs text-fg-muted">
            {room.roomType.code}
            {room.floor ? ` · ${room.floor}` : ""} · housekeeping{" "}
            {room.housekeepingStatus.toLowerCase()}
          </p>
          {room.inHouse ? (
            <p className="text-sm">
              <Link
                href={`/${property.code}/front-desk/stays/${room.inHouse.stayId}` as Route}
                className="text-brand hover:underline"
              >
                {room.inHouse.guestName}
              </Link>
              <span className="text-xs text-fg-muted">
                {" "}
                · departs {formatShortDate(room.inHouse.departure)}
              </span>
            </p>
          ) : null}
          {room.arriving ? (
            <p className="text-sm">
              <span className="text-xs text-fg-muted">Arriving: </span>
              <Link
                href={`/${property.code}/reservations/${room.arriving.reservationId}` as Route}
                className="text-brand hover:underline"
              >
                {room.arriving.guestName}
              </Link>
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
