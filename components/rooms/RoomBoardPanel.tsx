"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useRoomBoardOptionsQuery, useRoomBoardViewQuery } from "@/lib/api/endpoints/rooms.api";
import { toClientApiError } from "@/lib/api/errors";
import { RoomBoardGrid } from "./RoomBoardGrid";
import { RoomDetailDialog } from "./RoomDetailDialog";

const POLL_MS = 60_000;

/**
 * The room board with server-side filters (status filter from the caller,
 * floor and room type here) and the room dialog. Most urgent rooms first.
 */
export function RoomBoardPanel({ filter }: { filter: string }) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const [floorId, setFloorId] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // Very large properties get the board in pages (M11); a filter change starts over.
  const pageKey = `${filter}|${floorId}|${roomTypeId}`;
  const [paging, setPaging] = useState({ key: pageKey, offset: 0 });
  const offset = paging.key === pageKey ? paging.offset : 0;
  const allowed = can("rooms:read");
  const options = useRoomBoardOptionsQuery(property.id, { skip: !allowed });
  const board = useRoomBoardViewQuery(
    {
      propertyId: property.id,
      filter,
      floorId: floorId || undefined,
      roomTypeId: roomTypeId || undefined,
      offset: offset > 0 ? String(offset) : undefined,
    },
    { skip: !allowed, pollingInterval: POLL_MS, skipPollingIfUnfocused: true },
  );
  const page = board.data?.page;
  const error = toClientApiError(board.error);

  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the rooms:read permission."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Floor"
          placeholder="All floors"
          options={(options.data?.floors ?? []).map((f) => ({ value: f.id, label: f.name }))}
          value={floorId}
          onChange={(e) => setFloorId(e.target.value)}
          className="w-40"
        />
        <Select
          label="Room type"
          placeholder="All types"
          options={(options.data?.roomTypes ?? []).map((t) => ({
            value: t.id,
            label: `${t.code} · ${t.name}`,
          }))}
          value={roomTypeId}
          onChange={(e) => setRoomTypeId(e.target.value)}
          className="w-56"
        />
        {board.data ? (
          <p className="pb-2 text-xs text-fg-muted">
            {board.data.page.total} of {board.data.counts.total} rooms · {board.data.counts.urgent}{" "}
            urgent · {board.data.counts.dirty} dirty · {board.data.counts.maintenance} with open
            maintenance
          </p>
        ) : null}
      </div>
      {board.isLoading ? (
        <StatusPanel kind="loading" title="Loading rooms" />
      ) : error ? (
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
      ) : !board.data || board.data.items.length === 0 ? (
        <StatusPanel kind="empty" title="No rooms match these filters" />
      ) : (
        <RoomBoardGrid rooms={board.data.items} onSelect={(room) => setSelected(room.id)} />
      )}
      {page && page.total > page.limit ? (
        <nav aria-label="Room pages" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="me-auto text-fg-secondary">
            Rooms {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} of {page.total}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page.offset === 0 || board.isFetching}
            onClick={() =>
              setPaging({ key: pageKey, offset: Math.max(0, page.offset - page.limit) })
            }
          >
            Previous rooms
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={page.offset + page.limit >= page.total || board.isFetching}
            onClick={() => setPaging({ key: pageKey, offset: page.offset + page.limit })}
          >
            Next rooms
          </Button>
        </nav>
      ) : null}
      {selected && board.data ? (
        <RoomDetailDialog
          key={selected}
          roomId={selected}
          businessDate={board.data.businessDate}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
