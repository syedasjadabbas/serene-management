"use client";

import Link from "next/link";
import type { Route } from "next";
import { type ReactNode, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useMaintenanceCommandMutation,
  useMaintenanceOptionsQuery,
  useMaintenanceRequestQuery,
} from "@/lib/api/endpoints/maintenance.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { addDays } from "@/modules/business-date/business-date.policy";
import type {
  AssignRequestInput,
  BlockRequestRoomInput,
  CancelRequestInput,
  ResolveRequestInput,
} from "@/modules/maintenance/maintenance.schema";
import type { MaintenanceDetail } from "@/modules/maintenance/maintenance.types";
import { PriorityBadge, StatusBadge } from "../../components/RequestBadges";

type DialogKind = null | "assign" | "resolve" | "cancel" | "block";

/** One maintenance request: facts, room impact, activity and the actions the server allows. */
export function RequestDetailView({ requestId }: { requestId: string }) {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const allowed = can("maintenance:read");
  const query = useMaintenanceRequestQuery(
    { propertyId: property.id, requestId },
    { skip: !allowed },
  );
  const error = toClientApiError(query.error);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [command, { isLoading, error: commandError, originalArgs }] =
    useMaintenanceCommandMutation();
  const actionError = toClientApiError(commandError);

  if (permissionsLoading) return <StatusPanel kind="loading" title="Loading request" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the maintenance:read permission."
      />
    );
  }
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading request" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={error?.code === "NOT_FOUND" ? "empty" : "error"}
        title={error?.code === "NOT_FOUND" ? "Request not found" : "Could not load the request"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          <Link
            href={`/${property.code}/maintenance` as Route}
            className="text-sm text-brand hover:underline"
          >
            Back to maintenance
          </Link>
        }
      />
    );
  }

  const request = query.data;
  const a = request.allowedActions;
  const simple = (action: "start" | "hold" | "resume" | "close" | "reopen") =>
    void command({
      propertyId: property.id,
      requestId: request.id,
      action,
      body: { version: request.version },
    });
  const pending = (action: string) => isLoading && originalArgs?.action === action;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <Link href={`/${property.code}/maintenance` as Route} className="hover:underline">
          Maintenance
        </Link>{" "}
        / {request.requestNumber}
      </nav>

      <section className="rounded-lg border border-border-subtle bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <h1 className="text-lg font-semibold">{request.title}</h1>
          <PriorityBadge priority={request.priority} />
          <StatusBadge status={request.status} />
          {request.roomBlocked ? (
            <Badge tone="danger">
              {request.roomBlocked === "OUT_OF_ORDER" ? "Room out of order" : "Room out of service"}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {a.start ? (
            <Button size="touch" pending={pending("start")} onClick={() => simple("start")}>
              {request.assignee ? "Start work" : "Take & start"}
            </Button>
          ) : null}
          {a.resume ? (
            <Button size="touch" pending={pending("resume")} onClick={() => simple("resume")}>
              Resume
            </Button>
          ) : null}
          {a.resolve ? (
            <Button size="touch" onClick={() => setDialog("resolve")}>
              Resolve
            </Button>
          ) : null}
          {a.hold ? (
            <Button
              size="touch"
              variant="secondary"
              pending={pending("hold")}
              onClick={() => simple("hold")}
            >
              Put on hold
            </Button>
          ) : null}
          {a.assign ? (
            <Button size="touch" variant="secondary" onClick={() => setDialog("assign")}>
              {request.assignee ? "Reassign" : "Assign"}
            </Button>
          ) : null}
          {a.blockRoom ? (
            <Button size="touch" variant="danger" onClick={() => setDialog("block")}>
              Take room out of use
            </Button>
          ) : null}
          {a.close ? (
            <Button
              size="touch"
              variant="secondary"
              pending={pending("close")}
              onClick={() => simple("close")}
            >
              Close
            </Button>
          ) : null}
          {a.reopen ? (
            <Button
              size="touch"
              variant="secondary"
              pending={pending("reopen")}
              onClick={() => simple("reopen")}
            >
              Reopen
            </Button>
          ) : null}
          {a.cancel ? (
            <Button size="touch" variant="ghost" onClick={() => setDialog("cancel")}>
              Cancel request
            </Button>
          ) : null}
        </div>
        {actionError && !dialog ? (
          <div className="px-4 pt-3">
            <Alert tone="danger">{actionError.message}</Alert>
          </div>
        ) : null}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 p-4 sm:grid-cols-[10rem_1fr]">
          {(
            [
              ["Request", request.requestNumber],
              ["Where", request.room ? `Room ${request.room.number}` : (request.location ?? "—")],
              ["Category", `${request.category.code} · ${request.category.name}`],
              ["Assigned to", request.assignee?.name ?? "Unassigned"],
              [
                "Reported",
                `${formatDateTime(request.reportedAt, property.timezone)}${request.reportedBy ? ` by ${request.reportedBy}` : ""}`,
              ],
              [
                "Resolved",
                request.resolvedAt ? formatDateTime(request.resolvedAt, property.timezone) : "—",
              ],
              ["Resolution", request.resolution ?? "—"],
              ["Description", request.description ?? "—"],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-xs text-fg-muted sm:py-0.5">{term}</dt>
              <dd className="text-sm whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
        {request.blocks.length > 0 ? (
          <div className="border-t border-border-subtle px-4 py-3 text-sm">
            <h2 className="mb-1 font-semibold">Room availability</h2>
            <ul className="flex flex-col gap-1">
              {request.blocks.map((b) => (
                <li key={b.id}>
                  {b.kind === "OUT_OF_ORDER" ? "Out of order" : "Out of service"}{" "}
                  {formatDate(b.from)} → {formatDate(b.to)} · {b.status.toLowerCase()}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <ActivityLog request={request} />

      {dialog === "assign" ? (
        <AssignDialog request={request} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "resolve" ? (
        <ResolveDialog request={request} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "cancel" ? (
        <CancelDialog request={request} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "block" ? (
        <BlockDialog request={request} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function ActivityLog({ request }: { request: MaintenanceDetail }) {
  const property = useProperty();
  const [body, setBody] = useState("");
  const [command, { isLoading, error }] = useMaintenanceCommandMutation();
  const add = async () => {
    const result = await command({
      propertyId: property.id,
      requestId: request.id,
      action: "notes",
      body: { body: body.trim() },
    });
    if ("data" in result) setBody("");
  };
  return (
    <section
      aria-labelledby="activity-heading"
      className="rounded-lg border border-border-subtle bg-surface p-4"
    >
      <h2 id="activity-heading" className="mb-2 text-lg font-semibold">
        Activity
      </h2>
      {request.allowedActions.note ? (
        <div className="mb-3 flex flex-col gap-2">
          {error ? <Alert tone="danger">{toClientApiError(error)?.message}</Alert> : null}
          <TextArea
            label="Add a note"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
          />
          <div>
            <Button
              size="sm"
              pending={isLoading}
              disabled={!body.trim()}
              onClick={() => void add()}
            >
              Add note
            </Button>
          </div>
        </div>
      ) : null}
      <ol className="flex flex-col divide-y divide-border-subtle text-sm">
        {request.activities.map((activity) => (
          <li key={activity.id} className="flex flex-col gap-0.5 py-2">
            <span className="flex flex-wrap items-center gap-2">
              {activity.toStatus ? (
                <span className="font-medium">
                  {activity.fromStatus
                    ? `${activity.fromStatus.toLowerCase().replace("_", " ")} → `
                    : ""}
                  {activity.toStatus.toLowerCase().replace("_", " ")}
                </span>
              ) : (
                <span className="font-medium">
                  {activity.type === "ASSIGNMENT" ? "Assignment" : "Note"}
                </span>
              )}
              <span className="text-xs text-fg-muted">
                {formatDateTime(activity.at, property.timezone)}
                {activity.by ? ` · ${activity.by}` : ""}
              </span>
            </span>
            {activity.body ? <p className="whitespace-pre-wrap">{activity.body}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function CommandDialog({
  title,
  onClose,
  onSubmit,
  submitLabel,
  disabled,
  pending,
  error,
  danger,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
  pending: boolean;
  error: string | null;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            pending={pending}
            disabled={disabled}
            onClick={onSubmit}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {children}
      </div>
    </Dialog>
  );
}

function useCommand(request: MaintenanceDetail, onClose: () => void) {
  const property = useProperty();
  const [command, state] = useMaintenanceCommandMutation();
  const run = async (
    action: "assign" | "resolve" | "cancel" | "block-room",
    body:
      | Omit<AssignRequestInput, "version">
      | Omit<ResolveRequestInput, "version">
      | Omit<CancelRequestInput, "version">
      | Omit<BlockRequestRoomInput, "version">,
  ) => {
    const result = await command({
      propertyId: property.id,
      requestId: request.id,
      action,
      body: { version: request.version, ...body },
    });
    if ("data" in result) onClose();
  };
  return { run, pending: state.isLoading, error: toClientApiError(state.error)?.message ?? null };
}

function AssignDialog({ request, onClose }: { request: MaintenanceDetail; onClose: () => void }) {
  const property = useProperty();
  const options = useMaintenanceOptionsQuery(property.id);
  const [assigneeId, setAssigneeId] = useState(request.assignee?.id ?? "");
  const { run, pending, error } = useCommand(request, onClose);
  return (
    <CommandDialog
      title={`Assign ${request.requestNumber}`}
      onClose={onClose}
      onSubmit={() => void run("assign", { assigneeId })}
      submitLabel="Assign"
      disabled={!assigneeId || assigneeId === request.assignee?.id}
      pending={pending}
      error={error}
    >
      <Select
        label="Technician"
        placeholder="Select"
        options={(options.data?.assignees ?? []).map((u) => ({
          value: u.id,
          label: u.displayName,
        }))}
        value={assigneeId}
        onChange={(e) => setAssigneeId(e.target.value)}
      />
    </CommandDialog>
  );
}

function ResolveDialog({ request, onClose }: { request: MaintenanceDetail; onClose: () => void }) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const [resolution, setResolution] = useState("");
  const [returnToService, setReturnToService] = useState(true);
  const { run, pending, error } = useCommand(request, onClose);
  const blocked = request.roomBlocked !== null;
  const canRelease = can("rooms:out_of_order");
  return (
    <CommandDialog
      title={`Resolve ${request.requestNumber}`}
      onClose={onClose}
      onSubmit={() =>
        void run("resolve", {
          resolution: resolution.trim(),
          returnToService: blocked && canRelease ? returnToService : false,
        })
      }
      submitLabel="Resolve"
      disabled={resolution.trim().length < 3}
      pending={pending}
      error={error}
    >
      <TextArea
        label="What was done"
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        maxLength={4000}
      />
      {blocked ? (
        canRelease ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={returnToService}
              onChange={(e) => setReturnToService(e.target.checked)}
            />
            Return the room to service. It comes back dirty with a cleaning task and is ready only
            after housekeeping (and inspection where required).
          </label>
        ) : (
          <p className="text-sm text-fg-secondary">
            The room stays out of use until a supervisor returns it to service.
          </p>
        )
      ) : null}
    </CommandDialog>
  );
}

function CancelDialog({ request, onClose }: { request: MaintenanceDetail; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { run, pending, error } = useCommand(request, onClose);
  return (
    <CommandDialog
      title={`Cancel ${request.requestNumber}`}
      onClose={onClose}
      onSubmit={() => void run("cancel", { reason: reason.trim() })}
      submitLabel="Cancel request"
      danger
      disabled={reason.trim().length < 3}
      pending={pending}
      error={error}
    >
      <TextArea
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </CommandDialog>
  );
}

function BlockDialog({ request, onClose }: { request: MaintenanceDetail; onClose: () => void }) {
  const property = useProperty();
  const options = useMaintenanceOptionsQuery(property.id);
  const businessDate = useBusinessDate().data?.businessDate ?? null;
  const [kind, setKind] = useState<"OUT_OF_ORDER" | "OUT_OF_SERVICE">("OUT_OF_ORDER");
  const [to, setTo] = useState(businessDate ? addDays(businessDate, 1) : "");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [reason, setReason] = useState("");
  const { run, pending, error } = useCommand(request, onClose);
  const reasons = (options.data?.blockReasons ?? []).filter((r) => r.category === kind);
  return (
    <CommandDialog
      title={`Take room ${request.room?.number ?? ""} out of use`}
      onClose={onClose}
      onSubmit={() => void run("block-room", { kind, to, reasonCodeId, reason: reason.trim() })}
      submitLabel={kind === "OUT_OF_ORDER" ? "Put out of order" : "Put out of service"}
      danger
      disabled={!reasonCodeId || !to || reason.trim().length < 3}
      pending={pending}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Kind"
          options={[
            { value: "OUT_OF_ORDER", label: "Out of order" },
            { value: "OUT_OF_SERVICE", label: "Out of service" },
          ]}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setReasonCodeId("");
          }}
        />
        <TextField
          label="Expected back on"
          type="date"
          min={businessDate ? addDays(businessDate, 1) : undefined}
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
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </CommandDialog>
  );
}
