"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useGroupQuery } from "@/lib/api/endpoints/groups.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate, formatShortDate } from "@/lib/utils/format";
import type { BlockView, GroupDetail } from "@/modules/groups/groups.types";
import {
  AllocationDialog,
  BlockStatusDialog,
  GroupStatusDialog,
  NewBlockDialog,
  PickupDialog,
  ReleaseDialog,
} from "./GroupDialogs";

type Dialog =
  | null
  | { kind: "block" }
  | { kind: "groupStatus" }
  | { kind: "pickup" | "allocation" | "status" | "release"; block: BlockView };

const STATUS_TONES: Record<string, BadgeTone> = {
  INQUIRY: "neutral",
  NON_DEDUCT: "warning",
  DEDUCT: "success",
  CANCEL: "danger",
};

/** One group: identity, blocks with their per-night allocation grid, and pickups. */
export function GroupDetailView({ groupId }: { groupId: string }) {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const query = useGroupQuery({ propertyId: property.id, groupId }, { skip: !can("groups:read") });
  const error = toClientApiError(query.error);
  const [dialog, setDialog] = useState<Dialog>(null);

  if (isLoading) return <StatusPanel kind="loading" title="Loading group" />;
  if (!can("groups:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the groups:read permission."
      />
    );
  }
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading group" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={error?.code === "NOT_FOUND" ? "empty" : "error"}
        title={error?.code === "NOT_FOUND" ? "Group not found" : "Could not load the group"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          <Link
            href={`/${property.code}/groups` as Route}
            className="text-sm text-brand hover:underline"
          >
            Back to groups
          </Link>
        }
      />
    );
  }
  const group = query.data;
  const a = group.actions;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <Link href={`/${property.code}/groups` as Route} className="hover:underline">
          Groups
        </Link>{" "}
        / {group.code}
      </nav>
      <section className="rounded-lg border border-border-subtle bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <h1 className="text-lg font-semibold">{group.name}</h1>
          <Badge tone={group.status === "ACTIVE" ? "success" : "neutral"}>
            {group.status.toLowerCase()}
          </Badge>
          <span className="ms-auto flex flex-wrap gap-1.5">
            {a.manage ? (
              <Button
                size="sm"
                className="min-h-11 md:min-h-0"
                onClick={() => setDialog({ kind: "block" })}
              >
                New block
              </Button>
            ) : null}
            {a.manage ? (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 md:min-h-0"
                onClick={() => setDialog({ kind: "groupStatus" })}
              >
                Close or cancel group
              </Button>
            ) : null}
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Code", group.code],
              ["Company", group.account?.name ?? "—"],
              ["Contact", group.contact?.name ?? "—"],
              ["Created", formatDate(group.createdAt.slice(0, 10))],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="flex flex-col">
              <dt className="text-xs text-fg-muted">{term}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        {group.notes ? (
          <p className="px-4 pb-4 text-sm whitespace-pre-wrap text-fg-secondary">{group.notes}</p>
        ) : null}
      </section>

      {group.blocks.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="No blocks yet"
          description="Add a block to hold rooms for this group."
        />
      ) : (
        group.blocks.map((block) => (
          <BlockCard
            key={block.id}
            group={group}
            block={block}
            onAction={(kind) => setDialog({ kind, block })}
          />
        ))
      )}

      <section className="rounded-lg border border-border-subtle bg-surface p-4">
        <h2 className="mb-2 text-lg font-semibold">Reservations</h2>
        {group.reservations.length === 0 ? (
          <p className="text-sm text-fg-secondary">No rooms picked up yet.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">
                Reservations picked up from the group&apos;s blocks
              </caption>
              <thead className="text-left text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Confirmation
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Guest
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Room type
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Stay
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Block
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {group.reservations.map((r) => (
                  <tr key={r.reservationRoomId}>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/${property.code}/reservations/${r.reservationId}` as Route}
                        className="text-brand hover:underline"
                      >
                        {r.confirmation}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{r.guestName}</td>
                    <td className="py-2 pr-3">{r.roomType}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatShortDate(r.arrival)} → {formatShortDate(r.departure)}
                    </td>
                    <td className="py-2 pr-3">{r.blockCode ?? "—"}</td>
                    <td className="py-2">{r.status.toLowerCase().replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog?.kind === "block" ? (
        <NewBlockDialog group={group} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "groupStatus" ? (
        <GroupStatusDialog group={group} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && "block" in dialog && dialog.kind === "pickup" ? (
        <PickupDialog block={dialog.block} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && "block" in dialog && dialog.kind === "allocation" ? (
        <AllocationDialog block={dialog.block} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && "block" in dialog && dialog.kind === "status" ? (
        <BlockStatusDialog block={dialog.block} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && "block" in dialog && dialog.kind === "release" ? (
        <ReleaseDialog block={dialog.block} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function BlockCard({
  group,
  block,
  onAction,
}: {
  group: GroupDetail;
  block: BlockView;
  onAction: (kind: "pickup" | "allocation" | "status" | "release") => void;
}) {
  const a = group.actions;
  const definite = block.status.type === "DEDUCT";
  const cancelled = block.status.type === "CANCEL";
  const t = block.totals;
  return (
    <section className="rounded-lg border border-border-subtle bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <h2 className="font-semibold">
          {block.code} · {block.name}
        </h2>
        <Badge tone={STATUS_TONES[block.status.type] ?? "neutral"}>{block.status.name}</Badge>
        {block.isElastic ? <Badge tone="info">Elastic</Badge> : null}
        <span className="text-xs text-fg-muted">
          {formatDate(block.startDate)} → {formatDate(block.endDate)}
          {block.ratePlan ? ` · rate ${block.ratePlan.code}` : ""}
          {block.cutoffDate ? ` · cutoff ${formatDate(block.cutoffDate)}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm">
        <Badge tone="neutral">{t.allocated} held</Badge>
        <Badge tone="success">{t.pickedUp} picked up</Badge>
        {t.released ? <Badge tone="warning">{t.released} released</Badge> : null}
        <Badge tone="info">{t.remaining} remaining</Badge>
        <span className="text-xs text-fg-muted">room-nights</span>
      </div>
      {!cancelled ? (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {a.pickup && definite && block.status.allowsPickup ? (
            <Button
              size="touch"
              onClick={() => onAction("pickup")}
              disabled={t.remaining === 0 && !block.isElastic}
            >
              Pick up rooms
            </Button>
          ) : null}
          {a.manage ? (
            <Button size="touch" variant="secondary" onClick={() => onAction("allocation")}>
              Change allocation
            </Button>
          ) : null}
          {a.manage ? (
            <Button size="touch" variant="secondary" onClick={() => onAction("status")}>
              Change status
            </Button>
          ) : null}
          {a.manage && t.remaining > 0 ? (
            <Button size="touch" variant="ghost" onClick={() => onAction("release")}>
              Release rooms
            </Button>
          ) : null}
        </div>
      ) : null}
      {block.roomTypes.map((rt) => (
        <div
          key={rt.roomType.id}
          className="relative mt-3 overflow-x-auto border-t border-border-subtle"
        >
          <table className="w-full min-w-max text-sm">
            <caption className="px-4 pt-2 text-left text-xs font-medium text-fg-secondary">
              {rt.roomType.code} · {rt.roomType.name} — {rt.totals.pickedUp}/{rt.totals.allocated}{" "}
              picked up
            </caption>
            <thead className="text-xs text-fg-muted">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 bg-surface px-4 py-1.5 text-left font-medium"
                >
                  Night
                </th>
                {rt.nights.map((n) => (
                  <th
                    key={n.date}
                    scope="col"
                    className="px-2 py-1.5 text-center font-medium whitespace-nowrap"
                  >
                    {formatShortDate(n.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {(
                [
                  ["Held", "allocated"],
                  ["Picked up", "pickedUp"],
                  ["Released", "released"],
                  ["Remaining", "remaining"],
                ] as const
              ).map(([label, key]) => (
                <tr key={key} className={key === "remaining" ? "font-semibold" : undefined}>
                  <th
                    scope="row"
                    className="sticky left-0 bg-surface px-4 py-1 text-left text-xs font-medium text-fg-secondary"
                  >
                    {label}
                  </th>
                  {rt.nights.map((n) => (
                    <td key={n.date} className="px-2 py-1 text-center">
                      {n[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="h-3" />
    </section>
  );
}
