"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useCreateMaintenanceRequestMutation,
  useMaintenanceOptionsQuery,
} from "@/lib/api/endpoints/maintenance.api";
import { useRoomBoardViewQuery } from "@/lib/api/endpoints/rooms.api";
import { toClientApiError } from "@/lib/api/errors";
import { addDays } from "@/modules/business-date/business-date.policy";
import {
  MAINTENANCE_PRIORITIES,
  PRIORITY_LABELS,
  type MaintenancePriority,
} from "@/modules/maintenance/maintenance.policy";

/**
 * Report an issue for a room or a public area. Users who may block rooms can
 * take the room out of order / out of service in the same step.
 */
export function NewRequestDialog({ onClose }: { onClose: () => void }) {
  const property = useProperty();
  const router = useRouter();
  const { can } = usePermissions(property.id);
  const businessDate = useBusinessDate().data?.businessDate ?? null;
  const options = useMaintenanceOptionsQuery(property.id);
  const rooms = useRoomBoardViewQuery(
    { propertyId: property.id, filter: "all" },
    { skip: !can("rooms:read") },
  );
  const [roomId, setRoomId] = useState("");
  const [location, setLocation] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<MaintenancePriority>("NORMAL");
  const [assigneeId, setAssigneeId] = useState("");
  const [block, setBlock] = useState(false);
  const [blockKind, setBlockKind] = useState<"OUT_OF_ORDER" | "OUT_OF_SERVICE">("OUT_OF_ORDER");
  const [blockTo, setBlockTo] = useState(businessDate ? addDays(businessDate, 1) : "");
  const [blockReasonId, setBlockReasonId] = useState("");
  const [reason, setReason] = useState("");
  const [create, { isLoading, error }] = useCreateMaintenanceRequestMutation();
  const apiError = toClientApiError(error);
  const canManage = can("maintenance:manage");
  const blockReasons = (options.data?.blockReasons ?? []).filter((r) => r.category === blockKind);
  const canBlock = (options.data?.blockReasons.length ?? 0) > 0 && !!roomId;

  const invalid =
    !categoryId ||
    title.trim().length < 3 ||
    (!roomId && location.trim().length < 2) ||
    (block && (!blockReasonId || !blockTo || reason.trim().length < 3));

  const submit = async () => {
    const result = await create({
      propertyId: property.id,
      body: {
        ...(roomId ? { roomId } : { location: location.trim() }),
        categoryId,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        priority,
        ...(assigneeId ? { assigneeId } : {}),
        ...(block && roomId
          ? {
              blockRoom: { kind: blockKind, to: blockTo, reasonCodeId: blockReasonId },
              reason: reason.trim(),
            }
          : {}),
      },
    });
    if ("data" in result && result.data) {
      onClose();
      router.push(`/${property.code}/maintenance/${result.data.id}` as Route);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Report an issue"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button pending={isLoading} disabled={invalid} onClick={() => void submit()}>
            Report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {apiError ? <Alert tone="danger">{apiError.message}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Room"
            placeholder={rooms.data ? "Public area (no room)" : "Loading rooms…"}
            options={(rooms.data?.items ?? []).map((r) => ({
              value: r.id,
              label: `${r.number} · ${r.roomType.code}`,
            }))}
            value={roomId}
            onChange={(e) => {
              setRoomId(e.target.value);
              if (!e.target.value) setBlock(false);
            }}
          />
          {!roomId ? (
            <TextField
              label="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Lobby, pool, corridor 2"
            />
          ) : null}
          <Select
            label="Category"
            placeholder="Select"
            options={(options.data?.categories ?? []).map((c) => ({
              value: c.id,
              label: `${c.code} · ${c.name}`,
            }))}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          />
          <Select
            label="Priority"
            options={MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            value={priority}
            onChange={(e) => setPriority(e.target.value as MaintenancePriority)}
          />
          {canManage ? (
            <Select
              label="Assign to"
              placeholder="Unassigned"
              options={(options.data?.assignees ?? []).map((a) => ({
                value: a.id,
                label: a.displayName,
              }))}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            />
          ) : null}
        </div>
        <TextField
          label="Summary"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <TextArea
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
        />
        {canBlock ? (
          <fieldset className="flex flex-col gap-3 rounded-md border border-border-subtle p-3">
            <legend className="px-1 text-sm">Room availability</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />
              Take the room out of use while this is fixed (high-risk, audited)
            </label>
            {block ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select
                    label="Kind"
                    options={[
                      { value: "OUT_OF_ORDER", label: "Out of order (not sellable)" },
                      { value: "OUT_OF_SERVICE", label: "Out of service (sellable)" },
                    ]}
                    value={blockKind}
                    onChange={(e) => {
                      setBlockKind(e.target.value as typeof blockKind);
                      setBlockReasonId("");
                    }}
                  />
                  <TextField
                    label="Expected back on"
                    type="date"
                    min={businessDate ? addDays(businessDate, 1) : undefined}
                    value={blockTo}
                    onChange={(e) => setBlockTo(e.target.value)}
                  />
                  <Select
                    label="Reason code"
                    placeholder="Select"
                    options={blockReasons.map((r) => ({
                      value: r.id,
                      label: `${r.code} · ${r.name}`,
                    }))}
                    value={blockReasonId}
                    onChange={(e) => setBlockReasonId(e.target.value)}
                  />
                </div>
                <TextArea
                  label="Reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </>
            ) : null}
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  );
}
