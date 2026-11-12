"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/global/components/ui/Badge";
import { Button } from "@/global/components/ui/Button";
import { Card } from "@/global/components/ui/Card";
import { Select } from "@/global/components/ui/Select";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { Table, TableFrame, TBody, Td, Th, THead, Tr } from "@/global/components/ui/Table";
import type {
  PropertySetupView,
  SetupFloorView,
  SetupRoomView,
} from "@serene/shared/modules/setup/setup.types";
import { AddRoomsDialog, EditRoomDialog, FloorDialog } from "./RoomDialogs";

const HOUSEKEEPING: Record<string, string> = {
  DIRTY: "Dirty",
  CLEAN: "Clean",
  INSPECTED: "Inspected",
  PICKUP: "Pick-up",
};
const OCCUPANCY: Record<string, string> = { VACANT: "Vacant", OCCUPIED: "Occupied" };

/** Floors and rooms. Adding, retyping or retiring rooms changes what can be sold from the business date on. */
export function RoomsView({ setup, manage }: { setup: PropertySetupView; manage: boolean }) {
  const [floorDialog, setFloorDialog] = useState<SetupFloorView | "new" | null>(null);
  const [roomDialog, setRoomDialog] = useState<SetupRoomView | "new" | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const activeTypes = setup.roomTypes.filter((t) => t.status === "ACTIVE");
  const rooms = useMemo(
    () => setup.rooms.filter((r) => !typeFilter || r.roomTypeId === typeFilter),
    [setup.rooms, typeFilter],
  );

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Floors"
        description="Optional; floors group the room board and housekeeping."
        actions={
          manage ? (
            <Button size="sm" variant="secondary" onClick={() => setFloorDialog("new")}>
              New floor
            </Button>
          ) : null
        }
      >
        {setup.floors.length === 0 ? (
          <p className="text-sm text-fg-secondary">No floors yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {setup.floors.map((floor) => (
              <li key={floor.id}>
                <button
                  type="button"
                  disabled={!manage}
                  onClick={() => setFloorDialog(floor)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border-subtle px-3 text-sm enabled:hover:bg-surface-sunken md:min-h-9"
                >
                  <span className="font-medium">{floor.name}</span>
                  <span className="text-xs text-fg-muted">
                    {floor.activeRooms} room{floor.activeRooms === 1 ? "" : "s"}
                  </span>
                  {floor.status === "INACTIVE" ? <Badge>Retired</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {manage ? (
            <Button onClick={() => setRoomDialog("new")} disabled={activeTypes.length === 0}>
              Add rooms
            </Button>
          ) : null}
          {setup.roomTypes.length > 0 ? (
            <Select
              label="Room type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              options={[
                { value: "", label: "All room types" },
                ...setup.roomTypes.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` })),
              ]}
            />
          ) : null}
          <p className="pb-2 text-sm text-fg-secondary">
            {rooms.filter((r) => r.status === "ACTIVE").length} in use ·{" "}
            {rooms.filter((r) => r.status === "INACTIVE").length} retired
          </p>
        </div>
        {activeTypes.length === 0 ? (
          <StatusPanel
            kind="empty"
            title="Add a room type first"
            description="Every room belongs to a room type."
          />
        ) : rooms.length === 0 ? (
          <StatusPanel
            kind="empty"
            title="No rooms yet"
            description="Add rooms one at a time or as a range, for example 101-120."
          />
        ) : (
          <TableFrame label="Rooms">
            <Table caption="Rooms of the property">
              <THead>
                <tr>
                  <Th>Room</Th>
                  <Th>Type</Th>
                  <Th>Floor</Th>
                  <Th>Features</Th>
                  <Th>Housekeeping</Th>
                  <Th>Occupancy</Th>
                  <Th>Status</Th>
                  {manage ? (
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {rooms.map((room) => (
                  <Tr key={room.id}>
                    <Td className="font-mono text-sm font-medium">{room.number}</Td>
                    <Td className="font-mono text-xs">{room.roomTypeCode}</Td>
                    <Td>{room.floorName ?? "—"}</Td>
                    <Td className="text-sm text-fg-secondary">
                      {[room.isAccessible ? "Accessible" : null, room.isSmoking ? "Smoking" : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </Td>
                    <Td>{HOUSEKEEPING[room.housekeepingStatus] ?? room.housekeepingStatus}</Td>
                    <Td>{OCCUPANCY[room.frontOfficeStatus] ?? room.frontOfficeStatus}</Td>
                    <Td>
                      {room.status === "ACTIVE" ? (
                        <Badge tone="success">In use</Badge>
                      ) : (
                        <Badge>Retired</Badge>
                      )}
                    </Td>
                    {manage ? (
                      <Td className="text-end">
                        <Button size="sm" variant="secondary" onClick={() => setRoomDialog(room)}>
                          Edit
                        </Button>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        )}
      </section>

      {floorDialog ? (
        <FloorDialog
          floor={floorDialog === "new" ? null : floorDialog}
          onClose={() => setFloorDialog(null)}
        />
      ) : null}
      {roomDialog === "new" ? (
        <AddRoomsDialog setup={setup} onClose={() => setRoomDialog(null)} />
      ) : roomDialog ? (
        <EditRoomDialog setup={setup} room={roomDialog} onClose={() => setRoomDialog(null)} />
      ) : null}
    </div>
  );
}
