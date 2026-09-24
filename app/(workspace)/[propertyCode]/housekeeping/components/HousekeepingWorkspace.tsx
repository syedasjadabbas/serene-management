"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RoomBoardPanel } from "@/components/rooms/RoomBoardPanel";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useHousekeepingSummaryQuery } from "@/lib/api/endpoints/housekeeping.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate } from "@/lib/utils/format";
import { TaskList } from "./TaskList";

type View = "board" | "mine" | "open" | "inspections" | "all";

const VIEWS: View[] = ["board", "mine", "open", "inspections", "all"];

const BOARD_FILTERS = [
  { value: "all", label: "All rooms" },
  { value: "dirty", label: "Dirty" },
  { value: "clean", label: "Clean" },
  { value: "inspected", label: "Inspected" },
  { value: "vacant_ready", label: "Ready" },
  { value: "vacant_not_ready", label: "Vacant · not ready" },
  { value: "occupied", label: "Occupied" },
  { value: "vacant", label: "Vacant" },
  { value: "arriving", label: "Arrival today" },
  { value: "departing", label: "Departing" },
  { value: "out_of_order", label: "Out of order" },
  { value: "out_of_service", label: "Out of service" },
  { value: "maintenance", label: "Maintenance" },
];

/**
 * Housekeeping workspace for the business date: the room board (most urgent
 * rooms first), the caller's tasks, open tasks, rooms waiting for inspection
 * and all of today's tasks. View and board filter live in the URL.
 */
export function HousekeepingWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = can("housekeeping:read");
  const summary = useHousekeepingSummaryQuery(property.id, {
    skip: !allowed,
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });
  const summaryError = toClientApiError(summary.error);
  const requested = params.get("view") as View | null;
  const view: View = requested && VIEWS.includes(requested) ? requested : "board";
  const filter = BOARD_FILTERS.some((f) => f.value === params.get("filter"))
    ? params.get("filter")!
    : "all";

  if (isLoading) return <StatusPanel kind="loading" title="Loading housekeeping" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the housekeeping:read permission."
      />
    );
  }
  if (summaryError?.code === "BUSINESS_RULE_VIOLATION") {
    return (
      <StatusPanel
        kind="empty"
        title="Property not live"
        description="Housekeeping opens once the business date is initialized."
      />
    );
  }

  function navigate(next: { view?: View; filter?: string }) {
    const search = new URLSearchParams();
    const nextView = next.view ?? view;
    if (nextView !== "board") search.set("view", nextView);
    const nextFilter = next.view && next.view !== view ? "all" : (next.filter ?? filter);
    if (nextView === "board" && nextFilter !== "all") search.set("filter", nextFilter);
    router.replace((search.size ? `${pathname}?${search.toString()}` : pathname) as Route);
  }

  const counts = summary.data?.tasks;
  const tabs: { key: View; label: string; count: number | undefined }[] = [
    { key: "board", label: "Room board", count: undefined },
    { key: "mine", label: "My tasks", count: counts?.mine },
    { key: "open", label: "Open tasks", count: counts?.open },
    { key: "inspections", label: "Inspections", count: counts?.awaitingInspection },
    { key: "all", label: "All today", count: undefined },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Housekeeping</h1>
          <p className="text-xs text-fg-muted">
            Business date {summary.data ? formatDate(summary.data.businessDate) : "…"}
            {counts
              ? ` · ${counts.pending} to clean · ${counts.inProgress} in progress · ${counts.unassigned} unassigned · ${counts.completedToday} done today`
              : ""}
          </p>
        </div>
      </header>

      <nav aria-label="Housekeeping views" className="-mx-1 overflow-x-auto">
        <ul className="flex gap-1 px-1">
          {tabs.map((tab) => (
            <li key={tab.key}>
              <button
                type="button"
                aria-current={view === tab.key ? "page" : undefined}
                onClick={() => navigate({ view: tab.key })}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap",
                  view === tab.key
                    ? "border-brand bg-brand-subtle font-medium text-brand"
                    : "border-border-subtle bg-surface hover:bg-surface-sunken",
                )}
              >
                {tab.label}
                {tab.count !== undefined ? (
                  <span className="rounded-full bg-surface-sunken px-1.5 text-xs tabular-nums">
                    {tab.count}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {view === "board" ? (
        <>
          <div role="group" aria-label="Room filter" className="flex flex-wrap gap-1.5">
            {BOARD_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => navigate({ filter: option.value })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  filter === option.value
                    ? "border-brand bg-brand-subtle font-medium text-brand"
                    : "border-border-subtle text-fg-secondary hover:bg-surface-sunken",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <RoomBoardPanel filter={filter} />
        </>
      ) : (
        <TaskList view={view} />
      )}
    </div>
  );
}
