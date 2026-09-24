"use client";

import { type ReactNode, useState } from "react";
import { RoomReadinessBadge } from "@/components/front-desk/RoomStatusBadges";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useCreateHousekeepingTaskMutation,
  useHousekeepingOptionsQuery,
} from "@/lib/api/endpoints/housekeeping.api";
import {
  useInspectRoomMutation,
  usePlaceRoomBlockMutation,
  useReleaseRoomBlockMutation,
  useRoomBoardOptionsQuery,
  useRoomQuery,
  useSetRoomHousekeepingMutation,
} from "@/lib/api/endpoints/rooms.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { addDays } from "@/modules/business-date/business-date.policy";

type Mode = null | "inspect" | "block" | "release" | "task" | "dirty" | "clean";

const SOURCE_LABELS: Record<string, string> = {
  CHECK_IN: "check-in",
  CHECK_OUT: "check-out",
  ROOM_MOVE: "room move",
  HOUSEKEEPING: "housekeeping",
  MAINTENANCE: "maintenance",
  USER: "manual",
};

/**
 * Room detail with the operations the server allows for this user:
 * inspection, housekeeping corrections, cleaning task, out of order / out of
 * service and return to service. Every action is re-validated on the server.
 */
export function RoomDetailDialog({
  roomId,
  businessDate,
  onClose,
}: {
  roomId: string;
  businessDate: string;
  onClose: () => void;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const room = useRoomQuery({ propertyId: property.id, roomId });
  const [mode, setMode] = useState<Mode>(null);
  const data = room.data;
  const error = toClientApiError(room.error);

  const canInspect = can("housekeeping:inspect");
  const canDirty = can("housekeeping:update");
  const canClean = can("housekeeping:assign");
  const canBlock = can("rooms:out_of_order");
  const liveBlock = data?.blocks.find((b) => b.coversBusinessDate) ?? null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={data ? `Room ${data.number}` : "Room"}
      description={
        data
          ? `${data.roomType.code} · ${data.roomType.name}${data.floor ? ` · ${data.floor.name}` : ""}`
          : undefined
      }
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {room.isLoading ? (
        <Spinner label="Loading room" />
      ) : !data ? (
        <Alert tone="danger">{error?.message ?? "The room could not be loaded."}</Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-fg-muted">Readiness</dt>
              <dd>
                <RoomReadinessBadge readiness={data.readiness} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Occupancy</dt>
              <dd className="text-sm">{data.frontOfficeStatus.toLowerCase()}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Housekeeping</dt>
              <dd className="text-sm">{data.housekeepingStatus.toLowerCase()}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Service</dt>
              <dd className="text-sm">{data.serviceStatus.toLowerCase().replaceAll("_", " ")}</dd>
            </div>
          </dl>
          {data.requireInspected ? (
            <p className="text-xs text-fg-muted">
              This property only gives guests inspected rooms.
            </p>
          ) : null}

          {data.blocks.length > 0 ? (
            <section aria-label="Room blocks" className="flex flex-col gap-1">
              {data.blocks.map((b) => (
                <p key={b.id} className="text-sm">
                  <span className="font-medium">
                    {b.kind === "OUT_OF_ORDER" ? "Out of order" : "Out of service"}
                  </span>{" "}
                  {formatDate(b.from)} → {formatDate(b.to)} · {b.reason.name}
                  {b.notes ? ` · ${b.notes}` : ""}
                </p>
              ))}
            </section>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {canInspect && data.housekeepingStatus === "CLEAN" ? (
              <Button size="sm" onClick={() => setMode("inspect")}>
                Inspect
              </Button>
            ) : null}
            {canClean &&
            (data.housekeepingStatus === "DIRTY" || data.housekeepingStatus === "PICKUP") ? (
              <Button size="sm" variant="secondary" onClick={() => setMode("clean")}>
                Mark clean
              </Button>
            ) : null}
            {canDirty && data.housekeepingStatus !== "DIRTY" ? (
              <Button size="sm" variant="secondary" onClick={() => setMode("dirty")}>
                Mark dirty
              </Button>
            ) : null}
            {canClean ? (
              <Button size="sm" variant="secondary" onClick={() => setMode("task")}>
                New task
              </Button>
            ) : null}
            {canBlock && data.blocks.length === 0 ? (
              <Button size="sm" variant="danger" onClick={() => setMode("block")}>
                Out of order / service
              </Button>
            ) : null}
            {canBlock && data.blocks.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => setMode("release")}>
                Return to service
              </Button>
            ) : null}
          </div>

          {mode === "inspect" ? (
            <InspectForm roomId={data.id} version={data.version} onDone={() => setMode(null)} />
          ) : null}
          {mode === "dirty" || mode === "clean" ? (
            <HousekeepingForm
              roomId={data.id}
              version={data.version}
              action={mode === "dirty" ? "mark-dirty" : "mark-clean"}
              onDone={() => setMode(null)}
            />
          ) : null}
          {mode === "task" ? <TaskForm roomId={data.id} onDone={() => setMode(null)} /> : null}
          {mode === "block" ? (
            <BlockForm roomId={data.id} businessDate={businessDate} onDone={() => setMode(null)} />
          ) : null}
          {mode === "release" ? (
            <ReleaseForm
              roomId={data.id}
              blockId={(liveBlock ?? data.blocks[0]!).id}
              onDone={() => setMode(null)}
            />
          ) : null}

          <section aria-labelledby="room-history" className="flex flex-col gap-1">
            <h3 id="room-history" className="text-sm font-semibold">
              Status history
            </h3>
            {data.history.length === 0 ? (
              <p className="text-sm text-fg-secondary">No changes recorded.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border-subtle text-sm">
                {data.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2 py-1">
                    <span>
                      {h.field.toLowerCase().replace("_", " ")} {h.from?.toLowerCase()} →{" "}
                      {h.to?.toLowerCase()}
                    </span>
                    <span className="text-xs text-fg-muted">
                      {SOURCE_LABELS[h.source] ?? h.source.toLowerCase()} ·{" "}
                      {formatDateTime(h.at, property.timezone)}
                      {h.reason ? ` · ${h.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function FormShell({
  title,
  error,
  children,
  submitLabel,
  pending,
  disabled,
  onSubmit,
  onCancel,
  danger,
}: {
  title: string;
  error: string | null;
  children: ReactNode;
  submitLabel: string;
  pending: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border-subtle p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {children}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={danger ? "danger" : "primary"}
          pending={pending}
          disabled={disabled}
          onClick={onSubmit}
        >
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

function InspectForm({
  roomId,
  version,
  onDone,
}: {
  roomId: string;
  version: number;
  onDone: () => void;
}) {
  const property = useProperty();
  const [outcome, setOutcome] = useState<"PASS" | "FAIL">("PASS");
  const [notes, setNotes] = useState("");
  const [inspectRoom, { isLoading, error }] = useInspectRoomMutation();
  const submit = async () => {
    const result = await inspectRoom({
      propertyId: property.id,
      roomId,
      body: { version, outcome, ...(notes.trim() ? { notes: notes.trim() } : {}) },
    });
    if ("data" in result) onDone();
  };
  return (
    <FormShell
      title="Inspection"
      error={toClientApiError(error)?.message ?? null}
      submitLabel={outcome === "PASS" ? "Pass inspection" : "Fail inspection"}
      pending={isLoading}
      disabled={outcome === "FAIL" && notes.trim().length < 3}
      danger={outcome === "FAIL"}
      onSubmit={() => void submit()}
      onCancel={onDone}
    >
      <Select
        label="Outcome"
        options={[
          { value: "PASS", label: "Pass: the room is ready" },
          { value: "FAIL", label: "Fail: back to the attendant" },
        ]}
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as "PASS" | "FAIL")}
      />
      <TextArea
        label={outcome === "FAIL" ? "What failed (required)" : "Notes (optional)"}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
      />
    </FormShell>
  );
}

function HousekeepingForm({
  roomId,
  version,
  action,
  onDone,
}: {
  roomId: string;
  version: number;
  action: "mark-dirty" | "mark-clean";
  onDone: () => void;
}) {
  const property = useProperty();
  const [notes, setNotes] = useState("");
  const [setStatus, { isLoading, error }] = useSetRoomHousekeepingMutation();
  const submit = async () => {
    const result = await setStatus({
      propertyId: property.id,
      roomId,
      action,
      body: { version, ...(notes.trim() ? { notes: notes.trim() } : {}) },
    });
    if ("data" in result) onDone();
  };
  return (
    <FormShell
      title={action === "mark-dirty" ? "Mark the room dirty" : "Mark the room clean (no task)"}
      error={toClientApiError(error)?.message ?? null}
      submitLabel={action === "mark-dirty" ? "Mark dirty" : "Mark clean"}
      pending={isLoading}
      onSubmit={() => void submit()}
      onCancel={onDone}
    >
      <TextArea
        label="Reason (recorded in the room history)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
      />
    </FormShell>
  );
}

function TaskForm({ roomId, onDone }: { roomId: string; onDone: () => void }) {
  const property = useProperty();
  const options = useHousekeepingOptionsQuery(property.id);
  const [taskTypeId, setTaskTypeId] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "PRIORITY" | "URGENT">("NORMAL");
  const [assigneeId, setAssigneeId] = useState("");
  const [notes, setNotes] = useState("");
  const [create, { isLoading, error }] = useCreateHousekeepingTaskMutation();
  const submit = async () => {
    const result = await create({
      propertyId: property.id,
      body: {
        roomId,
        taskTypeId,
        priority,
        ...(assigneeId ? { assigneeId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
    });
    if ("data" in result) onDone();
  };
  return (
    <FormShell
      title="New housekeeping task"
      error={toClientApiError(error)?.message ?? null}
      submitLabel="Create task"
      pending={isLoading}
      disabled={!taskTypeId}
      onSubmit={() => void submit()}
      onCancel={onDone}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Type"
          placeholder="Select"
          options={(options.data?.taskTypes ?? []).map((t) => ({
            value: t.id,
            label: `${t.code} · ${t.name}`,
          }))}
          value={taskTypeId}
          onChange={(e) => setTaskTypeId(e.target.value)}
        />
        <Select
          label="Priority"
          options={[
            { value: "NORMAL", label: "Normal" },
            { value: "PRIORITY", label: "Priority" },
            { value: "URGENT", label: "Urgent" },
          ]}
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
        />
        <Select
          label="Attendant"
          placeholder="Unassigned"
          options={(options.data?.assignees ?? []).map((a) => ({
            value: a.id,
            label: a.displayName,
          }))}
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        />
      </div>
      <TextArea
        label="Instructions (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
      />
    </FormShell>
  );
}

function BlockForm({
  roomId,
  businessDate,
  onDone,
}: {
  roomId: string;
  businessDate: string;
  onDone: () => void;
}) {
  const property = useProperty();
  const options = useRoomBoardOptionsQuery(property.id);
  const [kind, setKind] = useState<"OUT_OF_ORDER" | "OUT_OF_SERVICE">("OUT_OF_ORDER");
  const [to, setTo] = useState(addDays(businessDate, 1));
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [place, { isLoading, error }] = usePlaceRoomBlockMutation();
  const reasons = (options.data?.blockReasons ?? []).filter((r) => r.category === kind);
  const submit = async () => {
    const result = await place({
      propertyId: property.id,
      roomId,
      body: { kind, to, reasonCodeId, reason: reason.trim() },
    });
    if ("data" in result) onDone();
  };
  return (
    <FormShell
      title="Take the room out of use"
      error={toClientApiError(error)?.message ?? null}
      submitLabel={kind === "OUT_OF_ORDER" ? "Put out of order" : "Put out of service"}
      pending={isLoading}
      danger
      disabled={!reasonCodeId || reason.trim().length < 3 || to <= businessDate}
      onSubmit={() => void submit()}
      onCancel={onDone}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Kind"
          options={[
            { value: "OUT_OF_ORDER", label: "Out of order (not sellable)" },
            { value: "OUT_OF_SERVICE", label: "Out of service (sellable)" },
          ]}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setReasonCodeId("");
          }}
        />
        <TextField
          label="Back in service on"
          type="date"
          min={addDays(businessDate, 1)}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Select
          label="Reason code"
          placeholder="Select"
          options={reasons.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))}
          value={reasonCodeId}
          onChange={(e) => setReasonCodeId(e.target.value)}
        />
      </div>
      <TextArea
        label="Reason (high-risk action, audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormShell>
  );
}

function ReleaseForm({
  roomId,
  blockId,
  onDone,
}: {
  roomId: string;
  blockId: string;
  onDone: () => void;
}) {
  const property = useProperty();
  const [reason, setReason] = useState("");
  const [release, { isLoading, error }] = useReleaseRoomBlockMutation();
  const submit = async () => {
    const result = await release({
      propertyId: property.id,
      blockId,
      roomId,
      body: { reason: reason.trim() },
    });
    if ("data" in result) onDone();
  };
  return (
    <FormShell
      title="Return to service"
      error={toClientApiError(error)?.message ?? null}
      submitLabel="Return to service"
      pending={isLoading}
      disabled={reason.trim().length < 3}
      onSubmit={() => void submit()}
      onCancel={onDone}
    >
      <p className="text-sm text-fg-secondary">
        The room comes back dirty with a priority cleaning task; it is ready only after cleaning
        (and inspection where required).
      </p>
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormShell>
  );
}
