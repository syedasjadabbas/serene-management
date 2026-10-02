"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { KeyFacts } from "@/components/ui/KeyFacts";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
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
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";

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

  if (isLoading) return <PageSkeleton title="Loading group" layout="detail" />;
  if (!can("groups:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the groups:read permission."
      />
    );
  }
  if (query.isLoading) return <PageSkeleton title="Loading group" layout="detail" />;
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
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        back={{ href: `/${property.code}/groups`, label: "Groups" }}
        icon={UsersRound}
        eyebrow="Group"
        title={group.name}
        meta={
          <Badge tone={group.status === "ACTIVE" ? "success" : "neutral"}>
            {group.status.toLowerCase()}
          </Badge>
        }
        actions={
          a.manage ? (
            <>
              <Button variant="ghost" onClick={() => setDialog({ kind: "groupStatus" })}>
                Close or cancel group
              </Button>
              <Button onClick={() => setDialog({ kind: "block" })}>New block</Button>
            </>
          ) : undefined
        }
        footer={
          <KeyFacts
            items={[
              { label: "Code", value: group.code, mono: true },
              { label: "Company", value: group.account?.name ?? "—" },
              { label: "Contact", value: group.contact?.name ?? "—" },
              { label: "Created", value: formatDate(group.createdAt.slice(0, 10)) },
            ]}
          />
        }
      />
      {group.notes ? (
        <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
          <p className="text-sm whitespace-pre-wrap text-fg-secondary">{group.notes}</p>
        </section>
      ) : null}

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

      <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
        <h2 className="mb-3 text-lg font-semibold tracking-[-0.01em]">Reservations</h2>
        {group.reservations.length === 0 ? (
          <p className="text-sm text-fg-secondary">No rooms picked up yet.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <Table caption="Reservations picked up from the group's blocks" minWidth="560px">
              <THead>
                <tr>
                  <Th>Confirmation</Th>
                  <Th>Guest</Th>
                  <Th>Room type</Th>
                  <Th>Stay</Th>
                  <Th>Block</Th>
                  <Th>Status</Th>
                </tr>
              </THead>
              <TBody>
                {group.reservations.map((r) => (
                  <Tr interactive key={r.reservationRoomId}>
                    <Td>
                      <Link
                        href={`/${property.code}/reservations/${r.reservationId}` as Route}
                        className="text-brand hover:underline"
                      >
                        {r.confirmation}
                      </Link>
                    </Td>
                    <Td>{r.guestName}</Td>
                    <Td>{r.roomType}</Td>
                    <Td className="whitespace-nowrap">
                      {formatShortDate(r.arrival)} → {formatShortDate(r.departure)}
                    </Td>
                    <Td>{r.blockCode ?? "—"}</Td>
                    <Td>{r.status.toLowerCase().replace("_", " ")}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
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
    <section className="rounded-lg border border-border-subtle bg-surface shadow-card">
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
              onClick={() => onAction("pickup")}
              disabled={t.remaining === 0 && !block.isElastic}
            >
              Pick up rooms
            </Button>
          ) : null}
          {a.manage ? (
            <Button variant="secondary" onClick={() => onAction("allocation")}>
              Change allocation
            </Button>
          ) : null}
          {a.manage ? (
            <Button variant="secondary" onClick={() => onAction("status")}>
              Change status
            </Button>
          ) : null}
          {a.manage && t.remaining > 0 ? (
            <Button variant="ghost" onClick={() => onAction("release")}>
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
          <Table
            caption={`${rt.roomType.code} · ${rt.roomType.name} — ${rt.totals.pickedUp}/${rt.totals.allocated} picked up`}
            captionHidden={false}
            minWidth="max-content"
          >
            <THead>
              <tr>
                <Th className="sticky left-0 bg-surface">Night</Th>
                {rt.nights.map((n) => (
                  <Th className="text-center" key={n.date}>
                    {formatShortDate(n.date)}
                  </Th>
                ))}
              </tr>
            </THead>
            <TBody>
              {(
                [
                  ["Held", "allocated"],
                  ["Picked up", "pickedUp"],
                  ["Released", "released"],
                  ["Remaining", "remaining"],
                ] as const
              ).map(([label, key]) => (
                <Tr
                  interactive
                  key={key}
                  className={key === "remaining" ? "font-semibold" : undefined}
                >
                  <Th className="sticky left-0 bg-surface text-xs text-fg-secondary" scope="row">
                    {label}
                  </Th>
                  {rt.nights.map((n) => (
                    <Td className="text-center" key={n.date}>
                      {n[key]}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ))}
      <div className="h-3" />
    </section>
  );
}
