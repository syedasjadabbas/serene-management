"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useMaintenanceRequestsQuery,
  useMaintenanceSummaryQuery,
} from "@/lib/api/endpoints/maintenance.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";
import {
  MAINTENANCE_VIEWS,
  PRIORITY_LABELS,
  type MaintenanceView,
} from "@/modules/maintenance/maintenance.policy";
import type { MaintenanceListItem } from "@/modules/maintenance/maintenance.types";
import { NewRequestDialog } from "./NewRequestDialog";
import { PriorityBadge, StatusBadge } from "./RequestBadges";

const VIEW_LABELS: Record<MaintenanceView, string> = {
  open: "Open",
  mine: "My work",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
  all: "All",
};

const PAGE_SIZE = 50;

/**
 * Maintenance workspace: requests by work state, most urgent first, with
 * server-side priority filter and search. View, priority and search live in
 * the URL.
 */
export function MaintenanceWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [reporting, setReporting] = useState(false);
  const allowed = can("maintenance:read");
  const summary = useMaintenanceSummaryQuery(property.id, {
    skip: !allowed,
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });
  const requested = params.get("view") as MaintenanceView | null;
  const view: MaintenanceView =
    requested && MAINTENANCE_VIEWS.includes(requested) ? requested : "open";
  const priority = params.get("priority") ?? "";
  const q = params.get("q") ?? "";

  if (isLoading) return <StatusPanel kind="loading" title="Loading maintenance" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the maintenance:read permission."
      />
    );
  }

  function navigate(next: { view?: MaintenanceView; priority?: string; q?: string }) {
    const search = new URLSearchParams();
    const nextView = next.view ?? view;
    if (nextView !== "open") search.set("view", nextView);
    const nextPriority = next.priority ?? priority;
    if (nextPriority) search.set("priority", nextPriority);
    const nextQ = next.q ?? q;
    if (nextQ) search.set("q", nextQ);
    router.replace((search.size ? `${pathname}?${search.toString()}` : pathname) as Route);
  }

  const counts = summary.data;
  const tabCount: Partial<Record<MaintenanceView, number | undefined>> = {
    open: counts?.open,
    mine: counts?.mine,
    in_progress: counts?.inProgress,
    resolved: counts?.resolved,
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Maintenance</h1>
          <p className="text-xs text-fg-muted">
            {counts
              ? `${counts.open} open · ${counts.unassigned} unassigned · ${counts.blockingRooms} taking a room out of use`
              : " "}
          </p>
        </div>
        {can("maintenance:create") ? (
          <Button onClick={() => setReporting(true)}>Report issue</Button>
        ) : null}
      </header>

      <nav aria-label="Maintenance views" className="-mx-1 overflow-x-auto">
        <ul className="flex gap-1 px-1">
          {MAINTENANCE_VIEWS.map((key) => (
            <li key={key}>
              <button
                type="button"
                aria-current={view === key ? "page" : undefined}
                onClick={() => navigate({ view: key })}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap",
                  view === key
                    ? "border-brand bg-brand-subtle font-medium text-brand"
                    : "border-border-subtle bg-surface hover:bg-surface-sunken",
                )}
              >
                {VIEW_LABELS[key]}
                {tabCount[key] !== undefined ? (
                  <span className="rounded-full bg-surface-sunken px-1.5 text-xs tabular-nums">
                    {tabCount[key]}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <Toolbar
        key={`${priority}-${q}`}
        priority={priority}
        q={q}
        onPriority={(value) => navigate({ priority: value })}
        onSearch={(value) => navigate({ q: value })}
      />

      <RequestList view={view} priority={priority} q={q} />

      {reporting ? <NewRequestDialog onClose={() => setReporting(false)} /> : null}
    </div>
  );
}

function Toolbar({
  priority,
  q,
  onPriority,
  onSearch,
}: {
  priority: string;
  q: string;
  onPriority: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  const [text, setText] = useState(q);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (value.length === 1) return;
    onSearch(value);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label="Priority" className="flex flex-wrap gap-1.5">
        {["", "URGENT", "HIGH", "NORMAL", "LOW"].map((value) => (
          <button
            key={value || "all"}
            type="button"
            aria-pressed={priority === value}
            onClick={() => onPriority(value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              priority === value
                ? "border-brand bg-brand-subtle font-medium text-brand"
                : "border-border-subtle text-fg-secondary hover:bg-surface-sunken",
            )}
          >
            {value ? PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS] : "All priorities"}
          </button>
        ))}
      </div>
      <form role="search" onSubmit={submit} className="flex gap-2">
        <label htmlFor="maintenance-search" className="sr-only">
          Search by title, request number or room
        </label>
        <input
          id="maintenance-search"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Title, number or room"
          className="h-control w-56 max-w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
    </div>
  );
}

function RequestList({ view, priority, q }: { view: string; priority: string; q: string }) {
  const key = `${view}|${priority}|${q}`;
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key,
    cursors: [undefined],
  });
  const cursors = pages.key === key ? pages.cursors : [undefined];
  return (
    <div className="flex flex-col gap-2">
      {cursors.map((cursor, index) => (
        <RequestPage
          key={`${key}-${cursor ?? "first"}`}
          view={view}
          priority={priority}
          q={q}
          cursor={cursor}
          first={index === 0}
          isLast={index === cursors.length - 1}
          onLoadMore={(next) => setPages({ key, cursors: [...cursors, next] })}
        />
      ))}
    </div>
  );
}

function RequestPage({
  view,
  priority,
  q,
  cursor,
  first,
  isLast,
  onLoadMore,
}: {
  view: string;
  priority: string;
  q: string;
  cursor: string | undefined;
  first: boolean;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
}) {
  const property = useProperty();
  const { data, isLoading, isFetching, error, refetch } = useMaintenanceRequestsQuery(
    {
      propertyId: property.id,
      view,
      priority: priority || undefined,
      q: q || undefined,
      cursor,
      limit: String(PAGE_SIZE),
    },
    { pollingInterval: first ? 60_000 : 0, skipPollingIfUnfocused: true },
  );
  const apiError = toClientApiError(error);
  if (isLoading) return <StatusPanel kind="loading" title="Loading requests" />;
  if (apiError) {
    return (
      <StatusPanel
        kind="error"
        title="Could not load requests"
        description={apiError.message}
        requestId={apiError.requestId}
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!data || (data.items.length === 0 && first)) {
    return <StatusPanel kind="empty" title="No maintenance requests here" />;
  }
  return (
    <>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {data.items.map((item) => (
          <li key={item.id}>
            <RequestCard item={item} />
          </li>
        ))}
      </ul>
      {isLast && data.meta.nextCursor ? (
        <div className="text-center">
          <Button
            variant="secondary"
            size="sm"
            pending={isFetching}
            onClick={() => onLoadMore(data.meta.nextCursor!)}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function RequestCard({ item }: { item: MaintenanceListItem }) {
  const property = useProperty();
  return (
    <Link
      href={`/${property.code}/maintenance/${item.id}` as Route}
      className="flex h-full flex-col gap-1.5 rounded-md border border-border-subtle bg-surface p-3 hover:bg-surface-sunken"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-fg-muted">{item.requestNumber}</span>
        <PriorityBadge priority={item.priority} />
        <StatusBadge status={item.status} />
        {item.roomBlocked ? (
          <Badge tone="danger">
            {item.roomBlocked === "OUT_OF_ORDER" ? "Room out of order" : "Room out of service"}
          </Badge>
        ) : null}
      </span>
      <span className="font-medium">{item.title}</span>
      <span className="text-xs text-fg-secondary">
        {item.room ? `Room ${item.room.number}` : item.location} · {item.category.name}
      </span>
      <span className="text-xs text-fg-muted">
        {item.assignee ? `${item.assignee.name}${item.mine ? " (you)" : ""}` : "Unassigned"} ·
        reported {formatDateTime(item.reportedAt, property.timezone)}
      </span>
    </Link>
  );
}
