"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useChangeBlockStatusMutation,
  useChangeGroupStatusMutation,
  useCreateBlockMutation,
  useGroupOptionsQuery,
  usePickupMutation,
  useReleaseBlockMutation,
  useSetAllocationMutation,
} from "@/lib/api/endpoints/groups.api";
import { useSearchGuestsQuery } from "@/lib/api/endpoints/guests.api";
import { toClientApiError } from "@/lib/api/errors";
import { addDays } from "@/modules/business-date/business-date.policy";
import type { BlockView, GroupDetail } from "@/modules/groups/groups.types";

const digits = (value: string) => value.replace(/\D/g, "");
const toInt = (value: string) => Number.parseInt(value || "0", 10);

/**
 * Overbooking past house availability is a separate, audited permission; the
 * checkbox is only offered to users who hold it (the server checks again).
 */
function OverrideField({
  override,
  setOverride,
  label,
}: {
  override: boolean;
  setOverride: (value: boolean) => void;
  label: string;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  if (!can("reservations:override_availability")) return null;
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
      {label}
    </label>
  );
}

export function NewBlockDialog({ group, onClose }: { group: GroupDetail; onClose: () => void }) {
  const property = useProperty();
  const options = useGroupOptionsQuery(property.id);
  const [create, state] = useCreateBlockMutation();
  const start0 = group.businessDate ?? options.data?.businessDate ?? "";
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [statusId, setStatusId] = useState("");
  const [ratePlanId, setRatePlanId] = useState("");
  const [startDate, setStartDate] = useState(start0);
  const [endDate, setEndDate] = useState(start0 ? addDays(start0, 1) : "");
  const [cutoffDate, setCutoffDate] = useState("");
  const [isElastic, setIsElastic] = useState(false);
  const [rooms, setRooms] = useState<Record<string, string>>({});
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const data = options.data;
  const status = statusId || data?.statuses.find((s) => s.isDefault)?.id || "";
  const allocations = Object.entries(rooms)
    .filter(([, v]) => toInt(v) > 0)
    .map(([roomTypeId, v]) => ({ roomTypeId, rooms: toInt(v) }));

  return (
    <FormDialog
      title="New block"
      description="Rooms held per night for each room type. A definite block takes them out of house availability."
      size="lg"
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          propertyId: property.id,
          groupId: group.id,
          body: {
            code: code.trim(),
            name: name.trim(),
            statusId: status,
            ratePlanId,
            startDate,
            endDate,
            cutoffDate: cutoffDate || null,
            isElastic,
            allocations,
            override,
            reason: reason.trim() || undefined,
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Create block"
      disabled={
        !code.trim() ||
        !name.trim() ||
        !status ||
        !ratePlanId ||
        !startDate ||
        !endDate ||
        allocations.length === 0 ||
        (override && reason.trim().length < 3)
      }
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={20}
          errors={error?.fieldErrors.code}
        />
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
        <Select
          label="Status"
          options={(data?.statuses ?? []).map((s) => ({
            value: s.id,
            label: `${s.name} (${s.code})`,
          }))}
          value={status}
          onChange={(e) => setStatusId(e.target.value)}
        />
        <Select
          label="Rate plan"
          placeholder="Choose a rate plan"
          options={(data?.ratePlans ?? []).map((p) => ({
            value: p.id,
            label: `${p.code} · ${p.name}`,
          }))}
          value={ratePlanId}
          onChange={(e) => setRatePlanId(e.target.value)}
          errors={error?.fieldErrors.ratePlanId}
        />
        <TextField
          label="First night"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <TextField
          label="Departure"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          errors={error?.fieldErrors.endDate}
        />
        <TextField
          label="Cutoff date (optional)"
          type="date"
          value={cutoffDate}
          onChange={(e) => setCutoffDate(e.target.value)}
          errors={error?.fieldErrors.cutoffDate}
        />
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={isElastic}
            onChange={(e) => setIsElastic(e.target.checked)}
          />
          Elastic (pickup may exceed the block from house availability)
        </label>
      </div>
      <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
        <legend className="px-1 text-sm">Rooms per night</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {(data?.roomTypes ?? []).map((rt) => (
            <TextField
              key={rt.id}
              label={`${rt.code} · ${rt.name}`}
              inputMode="numeric"
              value={rooms[rt.id] ?? ""}
              placeholder="0"
              onChange={(e) => setRooms((prev) => ({ ...prev, [rt.id]: digits(e.target.value) }))}
            />
          ))}
        </div>
        {error?.fieldErrors.allocations ? (
          <p className="text-sm text-danger">{error.fieldErrors.allocations.join(" ")}</p>
        ) : null}
      </fieldset>
      <OverrideField
        override={override}
        setOverride={setOverride}
        label="Hold beyond house availability (overbook, audited)"
      />
      {override ? (
        <TextArea
          label="Reason (audited)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
        />
      ) : null}
    </FormDialog>
  );
}

export function AllocationDialog({ block, onClose }: { block: BlockView; onClose: () => void }) {
  const property = useProperty();
  const [save, state] = useSetAllocationMutation();
  const lastNight = addDays(block.endDate, -1);
  const [roomTypeId, setRoomTypeId] = useState(block.roomTypes[0]?.roomType.id ?? "");
  const [from, setFrom] = useState(block.startDate);
  const [to, setTo] = useState(lastNight);
  const [rooms, setRooms] = useState("");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const options = useGroupOptionsQuery(property.id);
  const roomTypes = options.data?.roomTypes ?? block.roomTypes.map((rt) => rt.roomType);

  return (
    <FormDialog
      title={`Allocation · ${block.code}`}
      description="Sets the rooms held on each night in the range. It cannot go below the rooms already picked up."
      onClose={onClose}
      onSubmit={async () => {
        const result = await save({
          propertyId: property.id,
          blockId: block.id,
          body: {
            version: block.version,
            roomTypeId,
            from,
            to,
            rooms: toInt(rooms),
            override,
            reason: reason.trim() || undefined,
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save allocation"
      disabled={
        !roomTypeId || !from || !to || rooms === "" || (override && reason.trim().length < 3)
      }
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Room type"
          options={roomTypes.map((rt) => ({ value: rt.id, label: `${rt.code} · ${rt.name}` }))}
          value={roomTypeId}
          onChange={(e) => setRoomTypeId(e.target.value)}
        />
        <TextField
          label="Rooms per night"
          inputMode="numeric"
          value={rooms}
          onChange={(e) => setRooms(digits(e.target.value))}
          errors={error?.fieldErrors.rooms}
        />
        <TextField
          label="From night"
          type="date"
          min={block.startDate}
          max={lastNight}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="To night"
          type="date"
          min={block.startDate}
          max={lastNight}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          errors={error?.fieldErrors.to}
        />
      </div>
      <OverrideField
        override={override}
        setOverride={setOverride}
        label="Hold beyond house availability (overbook, audited)"
      />
      {override ? (
        <TextArea
          label="Reason (audited)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
        />
      ) : null}
    </FormDialog>
  );
}

export function BlockStatusDialog({ block, onClose }: { block: BlockView; onClose: () => void }) {
  const property = useProperty();
  const options = useGroupOptionsQuery(property.id);
  const [save, state] = useChangeBlockStatusMutation();
  const [statusId, setStatusId] = useState("");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const choices = (options.data?.statuses ?? []).filter((s) => s.id !== block.status.id);
  const target = choices.find((s) => s.id === statusId);

  return (
    <FormDialog
      title={`Block status · ${block.code}`}
      description={`Currently ${block.status.name}. Definite blocks hold inventory; a block with active pickups cannot leave definite.`}
      onClose={onClose}
      onSubmit={async () => {
        const result = await save({
          propertyId: property.id,
          blockId: block.id,
          body: { version: block.version, statusId, override, reason: reason.trim() || undefined },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Change status"
      danger={target?.type === "CANCEL"}
      disabled={!statusId || (override && reason.trim().length < 3)}
      pending={state.isLoading}
      error={error}
    >
      <Select
        label="New status"
        placeholder="Choose a status"
        options={choices.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
        value={statusId}
        onChange={(e) => setStatusId(e.target.value)}
      />
      {target?.type === "DEDUCT" ? (
        <OverrideField
          override={override}
          setOverride={setOverride}
          label="Hold beyond house availability (overbook, audited)"
        />
      ) : null}
      <TextArea
        label={override ? "Reason (audited)" : "Reason (optional)"}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormDialog>
  );
}

export function ReleaseDialog({ block, onClose }: { block: BlockView; onClose: () => void }) {
  const property = useProperty();
  const [release, state] = useReleaseBlockMutation();
  // One key per dialog: a retried submit replays instead of releasing twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const lastNight = addDays(block.endDate, -1);
  const [roomTypeId, setRoomTypeId] = useState("");
  const [from, setFrom] = useState(block.startDate);
  const [to, setTo] = useState(lastNight);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const error = toClientApiError(state.error);

  if (done !== null) {
    return (
      <FormDialog
        title="Rooms released"
        onClose={onClose}
        onSubmit={onClose}
        submitLabel="Done"
        pending={false}
        error={null}
      >
        <p className="text-sm">
          {done} room-night{done === 1 ? "" : "s"} returned to house availability.
        </p>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title={`Release rooms · ${block.code}`}
      description="Returns rooms the block still holds (not picked up) to house availability. Picked-up rooms are never released."
      onClose={onClose}
      onSubmit={async () => {
        const result = await release({
          propertyId: property.id,
          blockId: block.id,
          idempotencyKey,
          body: {
            version: block.version,
            roomTypeId: roomTypeId || undefined,
            from,
            to,
            reason: reason.trim(),
          },
        });
        if ("data" in result && result.data) setDone(result.data.released);
      }}
      submitLabel="Release"
      danger
      disabled={!from || !to || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Room type"
          placeholder="All room types"
          options={block.roomTypes.map((rt) => ({
            value: rt.roomType.id,
            label: rt.roomType.code,
          }))}
          value={roomTypeId}
          onChange={(e) => setRoomTypeId(e.target.value)}
        />
        <TextField
          label="From night"
          type="date"
          min={block.startDate}
          max={lastNight}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="To night"
          type="date"
          min={block.startDate}
          max={lastNight}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormDialog>
  );
}

export function PickupDialog({ block, onClose }: { block: BlockView; onClose: () => void }) {
  const property = useProperty();
  const [pickup, state] = usePickupMutation();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const guests = useSearchGuestsQuery(debounced, { skip: debounced.length < 2 });
  const [guest, setGuest] = useState<{ id: string; label: string } | null>(null);
  const [roomTypeId, setRoomTypeId] = useState(block.roomTypes[0]?.roomType.id ?? "");
  const [arrival, setArrival] = useState(block.startDate);
  const [departure, setDeparture] = useState(block.endDate);
  const [adults, setAdults] = useState("2");
  const [rooms, setRooms] = useState("1");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const error = toClientApiError(state.error);
  const remaining = block.roomTypes.find((rt) => rt.roomType.id === roomTypeId);

  if (done) {
    return (
      <FormDialog
        title="Picked up"
        onClose={onClose}
        onSubmit={onClose}
        submitLabel="Done"
        pending={false}
        error={null}
      >
        <p className="text-sm">
          The reservation was created at the block&apos;s rate (
          {block.ratePlan?.code ?? "block rate"}) and the pickup count updated.
        </p>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title={`Pick up · ${block.code}`}
      description={`Rate ${block.ratePlan?.code ?? "—"} and booking codes come from the block; the server prices every night.`}
      size="lg"
      onClose={onClose}
      onSubmit={async () => {
        if (!guest) return;
        const result = await pickup({
          propertyId: property.id,
          blockId: block.id,
          idempotencyKey,
          body: {
            guestId: guest.id,
            roomTypeId,
            arrival,
            departure,
            adults: toInt(adults),
            children: 0,
            rooms: toInt(rooms),
            override,
            reason: reason.trim() || undefined,
          },
        });
        if ("data" in result && result.data) setDone(result.data.reservationId);
      }}
      submitLabel="Create pickup"
      disabled={
        !guest ||
        !roomTypeId ||
        !arrival ||
        !departure ||
        toInt(adults) < 1 ||
        toInt(rooms) < 1 ||
        (override && reason.trim().length < 3)
      }
      pending={state.isLoading}
      error={error}
    >
      {guest ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Guest: <span className="font-medium">{guest.label}</span>
          <Button size="sm" variant="ghost" onClick={() => setGuest(null)}>
            Change
          </Button>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <TextField
            label="Find guest"
            placeholder="Name, email, phone or profile number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div aria-live="polite" className="max-h-48 overflow-y-auto">
            {debounced.length < 2 ? (
              <p className="text-sm text-fg-muted">Type at least 2 characters.</p>
            ) : guests.data && guests.data.length === 0 ? (
              <p className="text-sm text-fg-secondary">No guest found.</p>
            ) : (
              <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
                {(guests.data ?? []).map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-surface-sunken"
                      onClick={() =>
                        setGuest({ id: g.id, label: `${g.fullName} · ${g.profileNumber}` })
                      }
                    >
                      <span className="font-medium">{g.fullName}</span>
                      <span className="text-xs text-fg-muted">
                        {g.profileNumber}
                        {g.email ? ` · ${g.email}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Room type"
          options={block.roomTypes.map((rt) => ({
            value: rt.roomType.id,
            label: `${rt.roomType.code} · ${rt.totals.remaining} room-nights left`,
          }))}
          value={roomTypeId}
          onChange={(e) => setRoomTypeId(e.target.value)}
        />
        <TextField
          label="Rooms"
          inputMode="numeric"
          value={rooms}
          onChange={(e) => setRooms(digits(e.target.value).slice(0, 1))}
          errors={error?.fieldErrors.rooms}
        />
        <TextField
          label="Arrival"
          type="date"
          min={block.startDate}
          max={addDays(block.endDate, -1)}
          value={arrival}
          onChange={(e) => setArrival(e.target.value)}
        />
        <TextField
          label="Departure"
          type="date"
          min={addDays(block.startDate, 1)}
          max={block.endDate}
          value={departure}
          onChange={(e) => setDeparture(e.target.value)}
          errors={error?.fieldErrors.departure}
        />
        <TextField
          label="Adults per room"
          inputMode="numeric"
          value={adults}
          onChange={(e) => setAdults(digits(e.target.value).slice(0, 2))}
        />
      </div>
      {remaining ? (
        <p className="text-xs text-fg-muted">
          Held for {remaining.roomType.code}: {remaining.totals.allocated} room-nights,{" "}
          {remaining.totals.pickedUp} picked up. The server re-counts under a lock before creating
          the reservation.
        </p>
      ) : null}
      <OverrideField
        override={override}
        setOverride={setOverride}
        label="Overbook the house if needed (audited)"
      />
      {override ? (
        <TextArea
          label="Reason (audited)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
        />
      ) : null}
    </FormDialog>
  );
}

export function GroupStatusDialog({ group, onClose }: { group: GroupDetail; onClose: () => void }) {
  const property = useProperty();
  const [save, state] = useChangeGroupStatusMutation();
  const [status, setStatus] = useState<"CLOSED" | "CANCELLED">("CLOSED");
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={`Close or cancel · ${group.code}`}
      description="Cancelling moves every block to cancelled and releases held rooms; it is refused while rooms are picked up."
      onClose={onClose}
      onSubmit={async () => {
        const result = await save({
          propertyId: property.id,
          groupId: group.id,
          body: { status, reason: reason.trim() },
        });
        if ("data" in result) onClose();
      }}
      submitLabel={status === "CANCELLED" ? "Cancel group" : "Close group"}
      danger={status === "CANCELLED"}
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Select
        label="New status"
        options={[
          { value: "CLOSED", label: "Closed (completed)" },
          { value: "CANCELLED", label: "Cancelled" },
        ]}
        value={status}
        onChange={(e) => setStatus(e.target.value as "CLOSED" | "CANCELLED")}
      />
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormDialog>
  );
}
