"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { Table, TableFrame, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import {
  useCreateFloorMutation,
  useCreateRoomsMutation,
  useUpdateFloorMutation,
  useUpdateRoomMutation,
} from "@/lib/api/endpoints/setup.api";
import { toClientApiError } from "@/lib/api/errors";
import type { PropertySetupView, SetupFloorView, SetupRoomView } from "@/modules/setup/setup.types";
import { CheckboxField, ReasonField, STATUS_OPTIONS, parseRoomNumbers } from "./SetupFields";

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

function FloorDialog({ floor, onClose }: { floor: SetupFloorView | null; onClose: () => void }) {
  const property = useProperty();
  const [create, created] = useCreateFloorMutation();
  const [update, updated] = useUpdateFloorMutation();
  const state = floor ? updated : created;
  const [code, setCode] = useState(floor?.code ?? "");
  const [name, setName] = useState(floor?.name ?? "");
  const [level, setLevel] = useState(String(floor?.level ?? 1));
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(floor?.status ?? "ACTIVE");
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const levelNumber = Number.parseInt(level, 10);
  return (
    <FormDialog
      title={floor ? `Edit ${floor.name}` : "New floor"}
      description={floor ? "A floor can be retired once no room in use is on it." : undefined}
      onClose={onClose}
      onSubmit={async () => {
        const fields = { name: name.trim(), level: levelNumber, reason: reason.trim() };
        const result = floor
          ? await update({
              propertyId: property.id,
              floorId: floor.id,
              body: { ...fields, status },
            })
          : await create({ propertyId: property.id, body: { ...fields, code: code.trim() } });
        if ("data" in result) onClose();
      }}
      submitLabel={floor ? "Save floor" : "Add floor"}
      disabled={
        !name.trim() ||
        !Number.isInteger(levelNumber) ||
        reason.trim().length < 3 ||
        (!floor && !code.trim())
      }
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={20}
          disabled={floor !== null}
          hint={floor ? "The code never changes" : "For example F1"}
          errors={error?.fieldErrors.code}
          required
        />
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          errors={error?.fieldErrors.name}
          required
        />
        <TextField
          label="Level"
          type="number"
          inputMode="numeric"
          min={-10}
          max={200}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          errors={error?.fieldErrors.level}
        />
      </div>
      {floor ? (
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")}
          options={STATUS_OPTIONS}
        />
      ) : null}
      <ReasonField value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}

function typeOptions(setup: PropertySetupView, current?: string) {
  return setup.roomTypes
    .filter((t) => t.status === "ACTIVE" || t.id === current)
    .map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }));
}

function floorOptions(setup: PropertySetupView, current?: string | null) {
  return [
    { value: "", label: "No floor" },
    ...setup.floors
      .filter((f) => f.status === "ACTIVE" || f.id === current)
      .map((f) => ({ value: f.id, label: f.name })),
  ];
}

function AddRoomsDialog({ setup, onClose }: { setup: PropertySetupView; onClose: () => void }) {
  const property = useProperty();
  const [create, state] = useCreateRoomsMutation();
  const types = typeOptions(setup);
  const [numbersText, setNumbersText] = useState("");
  const [roomTypeId, setRoomTypeId] = useState(types[0]?.value ?? "");
  const [floorId, setFloorId] = useState("");
  const [housekeepingStatus, setHousekeepingStatus] = useState<"DIRTY" | "CLEAN" | "INSPECTED">(
    "INSPECTED",
  );
  const [isAccessible, setAccessible] = useState(false);
  const [isSmoking, setSmoking] = useState(false);
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const parsed = parseRoomNumbers(numbersText);
  return (
    <FormDialog
      title="Add rooms"
      description="The rooms are sellable from the business date on. Rooms that should not be sold yet can be placed out of order on the room board."
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          propertyId: property.id,
          body: {
            numbers: parsed.numbers,
            roomTypeId,
            floorId: floorId || null,
            housekeepingStatus,
            isAccessible,
            isSmoking,
            reason: reason.trim(),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel={parsed.numbers.length > 1 ? `Add ${parsed.numbers.length} rooms` : "Add room"}
      disabled={
        parsed.numbers.length === 0 || !!parsed.error || !roomTypeId || reason.trim().length < 3
      }
      pending={state.isLoading}
      error={error}
    >
      <TextField
        label="Room numbers"
        value={numbersText}
        onChange={(e) => setNumbersText(e.target.value)}
        hint={
          parsed.error ??
          (parsed.numbers.length > 0
            ? `${parsed.numbers.length} room${parsed.numbers.length === 1 ? "" : "s"}: ${parsed.numbers.slice(0, 6).join(", ")}${parsed.numbers.length > 6 ? " …" : ""}`
            : "One number, a list or ranges, for example 101-120, 125")
        }
        errors={error?.fieldErrors.numbers}
        required
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Room type"
          value={roomTypeId}
          onChange={(e) => setRoomTypeId(e.target.value)}
          options={types}
        />
        <Select
          label="Floor"
          value={floorId}
          onChange={(e) => setFloorId(e.target.value)}
          options={floorOptions(setup)}
        />
      </div>
      <Select
        label="Housekeeping status to start with"
        value={housekeepingStatus}
        onChange={(e) => setHousekeepingStatus(e.target.value as "DIRTY" | "CLEAN" | "INSPECTED")}
        options={[
          { value: "INSPECTED", label: "Inspected (ready to sell)" },
          { value: "CLEAN", label: "Clean (needs inspection)" },
          { value: "DIRTY", label: "Dirty (needs cleaning)" },
        ]}
      />
      <div className="flex flex-wrap gap-x-6">
        <CheckboxField checked={isAccessible} onChange={setAccessible}>
          Accessible room
        </CheckboxField>
        <CheckboxField checked={isSmoking} onChange={setSmoking}>
          Smoking room
        </CheckboxField>
      </div>
      <ReasonField value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}

function EditRoomDialog({
  setup,
  room,
  onClose,
}: {
  setup: PropertySetupView;
  room: SetupRoomView;
  onClose: () => void;
}) {
  const property = useProperty();
  const [update, state] = useUpdateRoomMutation();
  const [number, setNumber] = useState(room.number);
  const [roomTypeId, setRoomTypeId] = useState(room.roomTypeId);
  const [floorId, setFloorId] = useState(room.floorId ?? "");
  const [isAccessible, setAccessible] = useState(room.isAccessible);
  const [isSmoking, setSmoking] = useState(room.isSmoking);
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(room.status);
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={`Edit room ${room.number}`}
      description="A room can change type or be retired only while no guest is in it and no current or upcoming reservation is assigned to it."
      onClose={onClose}
      onSubmit={async () => {
        const result = await update({
          propertyId: property.id,
          roomId: room.id,
          body: {
            number: number.trim(),
            roomTypeId,
            floorId: floorId || null,
            description: room.description ?? undefined,
            isAccessible,
            isSmoking,
            status,
            version: room.version,
            reason: reason.trim(),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save room"
      disabled={!number.trim() || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Room number"
          value={number}
          onChange={(e) => setNumber(e.target.value.toUpperCase())}
          maxLength={20}
          errors={error?.fieldErrors.number}
          required
        />
        <Select
          label="Room type"
          value={roomTypeId}
          onChange={(e) => setRoomTypeId(e.target.value)}
          options={typeOptions(setup, room.roomTypeId)}
        />
        <Select
          label="Floor"
          value={floorId}
          onChange={(e) => setFloorId(e.target.value)}
          options={floorOptions(setup, room.floorId)}
        />
      </div>
      <div className="flex flex-wrap gap-x-6">
        <CheckboxField checked={isAccessible} onChange={setAccessible}>
          Accessible room
        </CheckboxField>
        <CheckboxField checked={isSmoking} onChange={setSmoking}>
          Smoking room
        </CheckboxField>
      </div>
      <Select
        label="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")}
        options={STATUS_OPTIONS}
      />
      <ReasonField value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}
