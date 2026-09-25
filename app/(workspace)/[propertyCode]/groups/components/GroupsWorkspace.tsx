"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useCreateGroupMutation, useGroupsQuery } from "@/lib/api/endpoints/groups.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate } from "@/lib/utils/format";
import type { GroupListItem } from "@/modules/groups/groups.types";

const STATUSES = [
  ["ACTIVE", "Active"],
  ["CLOSED", "Closed"],
  ["CANCELLED", "Cancelled"],
] as const;

/** Groups managed from this property with their block pickup. */
export function GroupsWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const router = useRouter();
  const [status, setStatus] = useState<string>("ACTIVE");
  const [creating, setCreating] = useState(false);
  const query = useGroupsQuery({ propertyId: property.id, status }, { skip: !can("groups:read") });
  const error = toClientApiError(query.error);

  if (isLoading) return <StatusPanel kind="loading" title="Loading groups" />;
  if (!can("groups:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the groups:read permission."
      />
    );
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Groups</h1>
          <p className="text-sm text-fg-muted">
            Blocks hold rooms for a group; guests are picked up into them at the block&apos;s rate.
          </p>
        </div>
        {can("groups:manage") ? (
          <Button size="touch" onClick={() => setCreating(true)}>
            New group
          </Button>
        ) : null}
      </div>
      <div role="tablist" aria-label="Group status" className="flex flex-wrap gap-1">
        {STATUSES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={status === id}
            onClick={() => setStatus(id)}
            className={cn(
              "min-h-11 rounded-md px-3 text-sm",
              status === id
                ? "bg-brand-subtle font-medium text-brand"
                : "text-fg-secondary hover:bg-surface-sunken",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {query.isLoading ? <StatusPanel kind="loading" title="Loading groups" /> : null}
      {error ? (
        <StatusPanel
          kind="error"
          title="Could not load groups"
          description={error.message}
          requestId={error.requestId}
        />
      ) : null}
      {query.data && query.data.items.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="No groups here"
          description="Create a group, then add a block for its rooms."
        />
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
          {query.data.items.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </ul>
      ) : null}
      {creating ? (
        <NewGroupDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/${property.code}/groups/${id}` as Route)}
        />
      ) : null}
    </div>
  );
}

function GroupRow({ group }: { group: GroupListItem }) {
  const property = useProperty();
  const t = group.totals;
  return (
    <li>
      <Link
        href={`/${property.code}/groups/${group.id}` as Route}
        className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-surface-sunken md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_auto]"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{group.name}</span>
          <span className="text-xs text-fg-muted">
            {group.code}
            {group.account ? ` · ${group.account}` : ""}
          </span>
        </span>
        <span className="text-sm">
          {group.firstNight
            ? `${formatDate(group.firstNight)} → ${formatDate(group.departure)}`
            : "No block yet"}
        </span>
        <span className="col-span-2 text-xs text-fg-muted md:col-span-1 md:text-sm">
          {group.blocks} block{group.blocks === 1 ? "" : "s"} · {t.pickedUp}/{t.allocated}{" "}
          room-nights picked up
          {t.released ? ` · ${t.released} released` : ""}
        </span>
        <span className="col-span-2 md:col-span-1 md:justify-self-end">
          <Badge tone={t.remaining > 0 ? "info" : "neutral"}>{t.remaining} remaining</Badge>
        </span>
      </Link>
    </li>
  );
}

function NewGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const property = useProperty();
  const [create, state] = useCreateGroupMutation();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title="New group"
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          propertyId: property.id,
          body: { code: code.trim(), name: name.trim(), notes: notes.trim() || null },
        });
        if ("data" in result && result.data) {
          onClose();
          onCreated(result.data.id);
        }
      }}
      submitLabel="Create group"
      disabled={!code.trim() || !name.trim()}
      pending={state.isLoading}
      error={error}
    >
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
      <TextArea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={4000}
      />
    </FormDialog>
  );
}
