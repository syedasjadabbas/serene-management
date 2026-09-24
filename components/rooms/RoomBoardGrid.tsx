"use client";

import { RoomBoardStatusBadge } from "@/components/front-desk/RoomStatusBadges";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { formatShortDate } from "@/lib/utils/format";
import type { RoomBoardRow } from "@/modules/rooms/rooms.types";

const EDGE: Record<RoomBoardRow["status"], string> = {
  OUT_OF_ORDER: "border-s-danger",
  OUT_OF_SERVICE: "border-s-warning",
  OCCUPIED: "border-s-info",
  VACANT_READY: "border-s-success",
  VACANT_NOT_READY: "border-s-warning",
};

const TASK_STATUS: Record<string, string> = {
  PENDING: "to clean",
  IN_PROGRESS: "cleaning",
  PAUSED: "paused",
  COMPLETED: "cleaned",
  FAILED_INSPECTION: "failed inspection",
};

/**
 * The shared room board: one tile per room with occupancy, housekeeping,
 * service and maintenance state. Guest names appear only when the server
 * sent them (frontdesk:read). Tiles are buttons when `onSelect` is given.
 */
export function RoomBoardGrid({
  rooms,
  onSelect,
}: {
  rooms: RoomBoardRow[];
  onSelect?: (room: RoomBoardRow) => void;
}) {
  return (
    <ul
      aria-label="Rooms"
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {rooms.map((room) => {
        const body = (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-base font-semibold">{room.number}</span>
                <span className="text-xs text-fg-muted">
                  {room.roomType.code}
                  {room.floor ? ` · ${room.floor.name}` : ""}
                </span>
              </span>
              <RoomBoardStatusBadge status={room.status} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-fg-secondary">
                {room.frontOfficeStatus === "OCCUPIED" ? "Occupied" : "Vacant"} ·{" "}
                {room.housekeepingStatus.toLowerCase()}
              </span>
              {room.urgency === "URGENT" ? <Badge tone="danger">Urgent</Badge> : null}
              {room.urgency === "PRIORITY" ? <Badge tone="warning">Priority</Badge> : null}
              {room.maintenance ? (
                <Badge tone={room.maintenance.topPriority === "URGENT" ? "danger" : "neutral"}>
                  Maintenance {room.maintenance.open > 1 ? `×${room.maintenance.open}` : ""}
                </Badge>
              ) : null}
            </div>
            {room.block ? (
              <p className="text-xs text-danger">
                {room.block.kind === "OUT_OF_ORDER" ? "Out of order" : "Out of service"} until{" "}
                {formatShortDate(room.block.until)}
                {room.block.reason ? ` · ${room.block.reason}` : ""}
              </p>
            ) : null}
            {room.inHouse ? (
              <p className="text-xs">
                {room.inHouse.guestName ?? "Guest in house"}
                {room.inHouse.vip ? ` · VIP ${room.inHouse.vip}` : ""}
                {room.inHouse.departingToday ? (
                  <span className="font-medium text-warning"> · departs today</span>
                ) : room.inHouse.departure ? (
                  <span className="text-fg-muted">
                    {" "}
                    · departs {formatShortDate(room.inHouse.departure)}
                  </span>
                ) : null}
              </p>
            ) : null}
            {room.arriving ? (
              <p className="text-xs">
                <span className="text-fg-muted">Arriving today: </span>
                {room.arriving.guestName ?? "guest assigned"}
                {room.arriving.eta ? ` · ETA ${room.arriving.eta}` : ""}
              </p>
            ) : null}
            {room.task ? (
              <p className="text-xs text-fg-secondary">
                {room.task.typeCode}{" "}
                {TASK_STATUS[room.task.status] ?? room.task.status.toLowerCase()}
                {room.task.attendant ? ` · ${room.task.attendant}` : " · unassigned"}
              </p>
            ) : null}
          </>
        );
        const className = cn(
          "flex w-full flex-col gap-1 rounded-md border border-s-4 border-border-subtle bg-surface px-3 py-2 text-start",
          EDGE[room.status],
        );
        return (
          <li key={room.id}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(room)}
                className={cn(className, "hover:bg-surface-sunken")}
              >
                {body}
              </button>
            ) : (
              <div className={className}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
