"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { Table, TableFrame, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import {
  useCreateRoomTypeMutation,
  useUpdateRoomTypeMutation,
} from "@/lib/api/endpoints/setup.api";
import { toClientApiError } from "@/lib/api/errors";
import type { PropertySetupView, SetupRoomTypeView } from "@/modules/setup/setup.types";
import { ReasonField, STATUS_OPTIONS } from "./SetupFields";

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

function RoomTypeDialog({
  type,
  onClose,
}: {
  type: SetupRoomTypeView | null;
  onClose: () => void;
}) {
  const property = useProperty();
  const [create, created] = useCreateRoomTypeMutation();
  const [update, updated] = useUpdateRoomTypeMutation();
  const state = type ? updated : created;
  const [code, setCode] = useState(type?.code ?? "");
  const [name, setName] = useState(type?.name ?? "");
  const [description, setDescription] = useState(type?.description ?? "");
  const [maxOccupancy, setMaxOccupancy] = useState(String(type?.maxOccupancy ?? 2));
  const [maxAdults, setMaxAdults] = useState(String(type?.maxAdults ?? 2));
  const [maxChildren, setMaxChildren] = useState(String(type?.maxChildren ?? 0));
  const [defaultOccupancy, setDefaultOccupancy] = useState(String(type?.defaultOccupancy ?? 2));
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(type?.status ?? "ACTIVE");
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const num = (value: string) => Number.parseInt(value, 10);
  const fields = {
    name: name.trim(),
    description: description.trim() || undefined,
    maxOccupancy: num(maxOccupancy),
    maxAdults: num(maxAdults),
    maxChildren: num(maxChildren),
    defaultOccupancy: num(defaultOccupancy),
    reason: reason.trim(),
  };
  const valid =
    fields.name.length > 0 &&
    [fields.maxOccupancy, fields.maxAdults, fields.maxChildren, fields.defaultOccupancy].every(
      (n) => Number.isInteger(n) && n >= 0,
    ) &&
    fields.reason.length >= 3 &&
    (type !== null || code.trim().length > 0);

  return (
    <FormDialog
      title={type ? `Edit ${type.code} · ${type.name}` : "New room type"}
      description={
        type
          ? "Occupancy limits apply to new bookings and changes. A room type can be retired once it has no rooms in use and no current or upcoming bookings."
          : "Rooms are added to a room type on the Rooms & floors tab; prices come from rate plans."
      }
      onClose={onClose}
      onSubmit={async () => {
        const result = type
          ? await update({
              propertyId: property.id,
              roomTypeId: type.id,
              body: { ...fields, status },
            })
          : await create({ propertyId: property.id, body: { ...fields, code: code.trim() } });
        if ("data" in result) onClose();
      }}
      submitLabel={type ? "Save room type" : "Add room type"}
      disabled={!valid}
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <TextField
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={20}
          disabled={type !== null}
          hint={type ? "The code never changes" : "For example DLX"}
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
      </div>
      <TextField
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TextField
          label="Max guests"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          value={maxOccupancy}
          onChange={(e) => setMaxOccupancy(e.target.value)}
          errors={error?.fieldErrors.maxOccupancy}
        />
        <TextField
          label="Max adults"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          value={maxAdults}
          onChange={(e) => setMaxAdults(e.target.value)}
          errors={error?.fieldErrors.maxAdults}
        />
        <TextField
          label="Max children"
          type="number"
          inputMode="numeric"
          min={0}
          max={20}
          value={maxChildren}
          onChange={(e) => setMaxChildren(e.target.value)}
          errors={error?.fieldErrors.maxChildren}
        />
        <TextField
          label="Usual guests"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          value={defaultOccupancy}
          onChange={(e) => setDefaultOccupancy(e.target.value)}
          errors={error?.fieldErrors.defaultOccupancy}
        />
      </div>
      {type ? (
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
