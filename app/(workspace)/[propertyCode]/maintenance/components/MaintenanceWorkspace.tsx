"use client";

import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { ViewNav } from "@/components/ui/ViewNav";
import { Wrench } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useMaintenanceRequestsQuery,
  useMaintenanceSummaryQuery,
} from "@/lib/api/endpoints/maintenance.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";
import {
  MAINTENANCE_PRIORITIES,
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

/** Empty-state copy per view: what would be listed here. */
const EMPTY_TEXT: Record<MaintenanceView, string> = {
  open: "Nothing is waiting. New issues reported by staff appear here until someone resolves them.",
  mine: "No requests are assigned to you right now.",
  in_progress: "No request is being worked on right now.",
  resolved: "Resolved requests wait here until they are checked and closed.",
  closed: "Closed requests are kept here as the room's maintenance history.",
  all: "No maintenance request has been reported for this property yet.",
};

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
  // A stale or hand-edited priority falls back to "all" instead of a 400.
  const requestedPriority = params.get("priority") ?? "";
  const priority = (MAINTENANCE_PRIORITIES as readonly string[]).includes(requestedPriority)
    ? requestedPriority
    : "";
  const q = params.get("q") ?? "";

  if (isLoading) return <PageSkeleton title="Loading maintenance" />;
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
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Wrench}
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Maintenance" },
        ]}
        title="Maintenance"
        description={
          counts
            ? `${counts.open} open · ${counts.unassigned} unassigned · ${counts.blockingRooms} taking a room out of use`
            : " "
        }
        actions={
          can("maintenance:create") ? (
            <Button onClick={() => setReporting(true)}>Report issue</Button>
          ) : undefined
        }
      />

      <ViewNav
        label="Maintenance views"
        items={MAINTENANCE_VIEWS.map((key) => ({
          key,
          label: VIEW_LABELS[key],
          count: tabCount[key],
        }))}
        value={view}
        onChange={(key) => navigate({ view: key })}
      />

      <Toolbar
        key={`${priority}-${q}`}
        priority={priority}
        q={q}
        onPriority={(value) => navigate({ priority: value })}
        onSearch={(value) => navigate({ q: value })}
      />

      <RequestList
        view={view}
        priority={priority}
        q={q}
        onClearFilters={() => navigate({ priority: "", q: "" })}
      />

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
  const [tooShort, setTooShort] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (value.length === 1) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    onSearch(value);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <ToggleGroup
        label="Priority"
        options={["", ...MAINTENANCE_PRIORITIES].map((value) => ({
          value,
          label: value ? PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS] : "All priorities",
        }))}
        value={priority}
        onChange={onPriority}
      />
      <form role="search" onSubmit={submit} className="flex flex-col gap-1">
        <div className="flex gap-2">
          <label htmlFor="maintenance-search" className="sr-only">
            Search by title, request number or room
          </label>
          <input
            id="maintenance-search"
            type="search"
            value={text}
            maxLength={100}
            onChange={(e) => {
              setText(e.target.value);
              if (tooShort) setTooShort(false);
            }}
            placeholder="Title, number or room"
            aria-invalid={tooShort || undefined}
            aria-describedby={tooShort ? "maintenance-search-hint" : undefined}
            className="h-control w-56 max-w-full rounded-md border border-border bg-surface px-2 text-sm"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {q ? (
            <Button type="button" variant="ghost" onClick={() => onSearch("")}>
              Clear
            </Button>
          ) : null}
        </div>
        {tooShort ? (
          <p id="maintenance-search-hint" role="alert" className="text-xs text-fg-muted">
            Type at least 2 characters.
          </p>
        ) : null}
      </form>
    </div>
  );
}

function RequestList({
  view,
  priority,
  q,
  onClearFilters,
}: {
  view: string;
  priority: string;
  q: string;
  onClearFilters: () => void;
}) {
  const key = `${view}|${priority}|${q}`;
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key,
    cursors: [undefined],
  });
  const cursors = pages.key === key ? pages.cursors : [undefined];
  return (
    <div className="flex flex-col gap-3">
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
          onClearFilters={onClearFilters}
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
  onClearFilters,
}: {
  view: string;
  priority: string;
  q: string;
  cursor: string | undefined;
  first: boolean;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
  onClearFilters: () => void;
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
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
        <SkeletonRows rows={first ? 4 : 2} columns={3} label="Loading requests" />
      </div>
    );
  }
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
    const filtered = Boolean(priority || q);
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface">
        <StatusPanel
          kind="empty"
          title={filtered ? "No requests match these filters" : "No maintenance requests here"}
          description={
            filtered
              ? "Try another priority or search, or clear the filters."
              : EMPTY_TEXT[view as MaintenanceView]
          }
          action={
            filtered ? (
              <Button variant="secondary" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  return (
    <>
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
        {data.items.map((item) => (
          <li key={item.id}>
            <RequestRow item={item} />
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

/** One request as a full-width row: what and where on the left, who and when on the right. */
function RequestRow({ item }: { item: MaintenanceListItem }) {
  const property = useProperty();
  return (
    <Link
      href={`/${property.code}/maintenance/${item.id}` as Route}
      className="flex flex-col gap-1.5 px-4 py-3 hover:bg-surface-sunken md:grid md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] md:items-center md:gap-x-6"
    >
      <span className="flex min-w-0 flex-col gap-1">
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
      </span>
      <span className="flex flex-col text-xs text-fg-muted md:items-end md:text-end">
        <span className={item.assignee ? "text-fg-secondary" : undefined}>
          {item.assignee ? `${item.assignee.name}${item.mine ? " (you)" : ""}` : "Unassigned"}
        </span>
        <span>Reported {formatDateTime(item.reportedAt, property.timezone)}</span>
      </span>
    </Link>
  );
}
