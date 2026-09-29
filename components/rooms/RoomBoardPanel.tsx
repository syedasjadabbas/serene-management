"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The room board with server-side filters (status filter from the caller,
 * floor and room type here, both kept in the URL as `?floor=` and
 * `?roomType=` so they survive reloads and view switches) and the room
 * dialog. Most urgent rooms first.
 */
export function RoomBoardPanel({
  filter,
  onClearFilter,
}: {
  filter: string;
  /** Resets the caller's status filter (Clear filters on an empty result). */
  onClearFilter?: () => void;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // A malformed id in the URL is ignored rather than sent to the API.
  const valid = (value: string | null) => (value && UUID.test(value) ? value : "");
  const floorId = valid(params.get("floor"));
  const roomTypeId = valid(params.get("roomType"));
  const setParams = (next: Record<string, string>) => {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    search.delete("room");
    router.replace((search.size ? `${pathname}?${search.toString()}` : pathname) as Route, {
      scroll: false,
    });
  };
  const setFloorId = (value: string) => setParams({ floor: value });
  const setRoomTypeId = (value: string) => setParams({ roomType: value });
  // `?room=<id>` (a global search result) opens that room on arrival.
  const [selected, setSelected] = useState<string | null>(params.get("room"));
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
  // Only rows for the current filters: while a new filter loads, the old
  // result is not shown as if it were current.
  const current = board.currentData;
  const page = current?.page;
  const filtered = filter !== "all" || floorId !== "" || roomTypeId !== "";
  const clearFilters = () => {
    if (filter !== "all" && onClearFilter) onClearFilter();
    else setParams({ floor: "", roomType: "" });
  };
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
        {current ? (
          <p aria-live="polite" className="pb-2 text-xs text-fg-muted">
            {current.page.total} of {current.counts.total} rooms · {current.counts.urgent} urgent ·{" "}
            {current.counts.dirty} dirty · {current.counts.maintenance} with open maintenance
          </p>
        ) : null}
        {filtered ? (
          <Button variant="ghost" size="sm" className="mb-1" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
      {board.isLoading || (board.isFetching && !current) ? (
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
      ) : !current || current.items.length === 0 ? (
        filtered ? (
          <StatusPanel
            kind="empty"
            title="No rooms match these filters"
            description="Try another status, floor or room type."
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <StatusPanel
            kind="empty"
            title="No rooms set up yet"
            description="Rooms appear here once they are added to this property."
          />
        )
      ) : (
        <RoomBoardGrid rooms={current.items} onSelect={(room) => setSelected(room.id)} />
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
