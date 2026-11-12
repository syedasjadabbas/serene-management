"use client";

import { useState } from "react";
import { Badge } from "@/global/components/ui/Badge";
import { Button } from "@/global/components/ui/Button";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { Table, TableFrame, TBody, Td, Th, THead, Tr } from "@/global/components/ui/Table";
import type {
  PropertySetupView,
  SetupRoomTypeView,
} from "@serene/shared/modules/setup/setup.types";
import { RoomTypeDialog } from "./RoomTypeDialog";

/** Room types: what is sold and priced. Rooms belong to one type each. */
export function RoomTypesView({ setup, manage }: { setup: PropertySetupView; manage: boolean }) {
  const [editing, setEditing] = useState<SetupRoomTypeView | "new" | null>(null);
  return (
    <section className="flex flex-col gap-3">
      {manage ? (
        <div>
          <Button onClick={() => setEditing("new")}>New room type</Button>
        </div>
      ) : null}
      {setup.roomTypes.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="No room types yet"
          description="Add the kinds of room the property sells (for example Deluxe King, Twin), then add the rooms."
        />
      ) : (
        <TableFrame label="Room types">
          <Table caption="Room types of the property">
            <THead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th numeric>Max guests</Th>
                <Th numeric>Adults</Th>
                <Th numeric>Children</Th>
                <Th numeric>Rooms in use</Th>
                <Th>Status</Th>
                {manage ? (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {setup.roomTypes.map((type) => (
                <Tr key={type.id}>
                  <Td className="font-mono text-sm">{type.code}</Td>
                  <Td>{type.name}</Td>
                  <Td numeric>{type.maxOccupancy}</Td>
                  <Td numeric>{type.maxAdults}</Td>
                  <Td numeric>{type.maxChildren}</Td>
                  <Td numeric>{type.activeRooms}</Td>
                  <Td>
                    {type.status === "ACTIVE" ? (
                      <Badge tone="success">In use</Badge>
                    ) : (
                      <Badge>Retired</Badge>
                    )}
                  </Td>
                  {manage ? (
                    <Td className="text-end">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(type)}>
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
      {editing ? (
        <RoomTypeDialog
          type={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
