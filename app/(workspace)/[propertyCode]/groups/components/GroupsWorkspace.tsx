"use client";

import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { UsersRound } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
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

/** Empty-state copy per status tab: what belongs there and how it gets there. */
const EMPTY: Record<string, { title: string; description: string }> = {
  ACTIVE: {
    title: "No active groups",
    description: "Create a group for a wedding, tour or event, then add a block to hold its rooms.",
  },
  CLOSED: {
    title: "No closed groups",
    description: "Groups appear here once their stay is over and they are closed.",
  },
  CANCELLED: {
    title: "No cancelled groups",
    description: "Cancelled groups are kept here for reference.",
  },
};

/** Row layout shared by the column headings and the rows (md and up). */
const ROW_GRID =
  "md:grid-cols-[minmax(0,2fr)_minmax(max-content,1.4fr)_minmax(0,2fr)_minmax(7.5rem,auto)]";

/** Groups managed from this property with their block pickup. */
export function GroupsWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const router = useRouter();
  const [status, setStatus] = useState<string>("ACTIVE");
  const [creating, setCreating] = useState(false);
  const query = useGroupsQuery({ propertyId: property.id, status }, { skip: !can("groups:read") });
  const error = toClientApiError(query.error);

  if (isLoading) return <PageSkeleton title="Loading groups" />;
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
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={UsersRound}
        breadcrumbs={[{ label: property.code, href: `/${property.code}` }, { label: "Groups" }]}
        title="Groups"
        description="Blocks hold rooms for a group; guests are picked up into them at the block's rate."
        actions={
          can("groups:manage") ? (
            <Button size="touch" onClick={() => setCreating(true)}>
              New group
            </Button>
          ) : undefined
        }
      />
      <ToggleGroup
        label="Group status"
        options={STATUSES.map(([value, label]) => ({ value, label }))}
        value={status}
        onChange={setStatus}
      />
      {query.isLoading ? (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
          <SkeletonRows rows={4} columns={4} label="Loading groups" />
        </div>
      ) : null}
      {error ? (
        <StatusPanel
          kind="error"
          title="Could not load groups"
          description={error.message}
          requestId={error.requestId}
        />
      ) : null}
      {query.data && query.data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <StatusPanel
            kind="empty"
            title={EMPTY[status]?.title ?? "No groups here"}
            description={EMPTY[status]?.description}
            action={
              status === "ACTIVE" && can("groups:manage") ? (
                <Button variant="secondary" onClick={() => setCreating(true)}>
                  New group
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <section
          aria-label="Groups"
          className="overflow-hidden rounded-lg border border-border-subtle bg-surface"
        >
          <div
            aria-hidden="true"
            className={`hidden items-center gap-x-4 border-b border-border-subtle bg-surface-sunken px-4 py-2 text-xs font-medium text-fg-secondary md:grid ${ROW_GRID}`}
          >
            <span>Group</span>
            <span>Stay</span>
            <span>Pickup</span>
            <span className="justify-self-end">Remaining</span>
          </div>
          <ul className="divide-y divide-border-subtle">
            {query.data.items.map((group) => (
              <GroupRow key={group.id} group={group} />
            ))}
          </ul>
          <p className="border-t border-border-subtle px-4 py-2 text-xs text-fg-muted">
            Showing {query.data.items.length} {query.data.items.length === 1 ? "group" : "groups"}
            {query.data.meta.nextCursor ? " (first page)" : ""}
          </p>
        </section>
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
        className={`grid min-h-14 grid-cols-1 items-center gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-surface-sunken ${ROW_GRID}`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{group.name}</span>
          <span className="text-xs text-fg-muted">
            {group.code}
            {group.account ? ` · ${group.account}` : ""}
          </span>
        </span>
        <span className="text-xs text-fg-secondary md:text-sm md:whitespace-nowrap md:text-fg">
          {group.firstNight
            ? `${formatDate(group.firstNight)} → ${formatDate(group.departure)}`
            : "No block yet"}
        </span>
        <span className="text-xs text-fg-muted md:text-sm">
          {group.blocks} block{group.blocks === 1 ? "" : "s"} · {t.pickedUp}/{t.allocated}{" "}
          room-nights picked up
          {t.released ? ` · ${t.released} released` : ""}
        </span>
        <span className="mt-1 md:mt-0 md:justify-self-end">
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
