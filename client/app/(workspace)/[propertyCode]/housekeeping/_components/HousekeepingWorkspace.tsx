"use client";

import { ToggleGroup } from "@/global/components/ui/ToggleGroup";
import { ViewNav, type ViewNavItem } from "@/global/components/ui/ViewNav";
import { BedDouble, Plus } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { RoomBoardPanel } from "@/global/components/rooms/RoomBoardPanel";
import { Button } from "@/global/components/ui/Button";
import { PageHeader } from "@/global/components/ui/PageHeader";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useLivePolling } from "@/global/hooks/useLivePolling";
import { useProperty } from "@/global/hooks/useProperty";
import { useHousekeepingSummaryQuery } from "@/global/api/endpoints/housekeepingApi";
import { toClientApiError } from "@/global/api/errors";
import { formatDate } from "@serene/shared/lib/utils/format";
import { AddTaskDialog } from "./AddTaskDialog";
import { TaskList } from "./TaskList";

type View = "board" | "mine" | "open" | "inspections" | "all" | "scheduled";

const VIEWS: View[] = ["board", "mine", "open", "inspections", "all", "scheduled"];

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
 * and all of today's tasks, plus tasks scheduled for later dates. View and
 * board filter live in the URL. Users with `housekeeping:assign` (and the
 * room list, `rooms:read`) add tasks by hand from the header.
 */
export function HousekeepingWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = can("housekeeping:read");
  const canAdd = can("housekeeping:assign") && can("rooms:read");
  const [adding, setAdding] = useState(false);
  const summary = useHousekeepingSummaryQuery(property.id, {
    skip: !allowed,
    pollingInterval: useLivePolling("housekeeping", 60_000),
    skipPollingIfUnfocused: true,
  });
  const summaryError = toClientApiError(summary.error);
  // The room board needs rooms:read; a housekeeping-only user starts on their tasks.
  const canBoard = can("rooms:read");
  const defaultView: View = canBoard ? "board" : "mine";
  const requested = params.get("view") as View | null;
  const view: View =
    requested && VIEWS.includes(requested) && (requested !== "board" || canBoard)
      ? requested
      : defaultView;
  const filter = BOARD_FILTERS.some((f) => f.value === params.get("filter"))
    ? params.get("filter")!
    : "all";

  if (isLoading) return <PageSkeleton title="Loading housekeeping" />;
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
    if (nextView !== defaultView) search.set("view", nextView);
    const nextFilter = next.view && next.view !== view ? "all" : (next.filter ?? filter);
    if (nextView === "board" && nextFilter !== "all") search.set("filter", nextFilter);
    // The room board's floor and room type stay while the view stays.
    if (!next.view || next.view === view) {
      for (const key of ["floor", "roomType"]) {
        const value = params.get(key);
        if (value) search.set(key, value);
      }
    }
    router.replace((search.size ? `${pathname}?${search.toString()}` : pathname) as Route, {
      scroll: false,
    });
  }

  const counts = summary.data?.tasks;
  const tabs: ViewNavItem<View>[] = [
    ...(canBoard ? [{ key: "board" as const, label: "Room board", count: undefined }] : []),
    { key: "mine", label: "My tasks", count: counts?.mine },
    { key: "open", label: "Open tasks", count: counts?.open },
    { key: "inspections", label: "Inspections", count: counts?.awaitingInspection },
    { key: "all", label: "All today", count: undefined },
    { key: "scheduled", label: "Scheduled", count: counts?.scheduled },
  ];
  const businessDate = summary.data?.businessDate ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BedDouble}
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Housekeeping" },
        ]}
        title="Housekeeping"
        actions={
          canAdd ? (
            <Button disabled={!businessDate} onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" className="size-4" />
              Add task
            </Button>
          ) : null
        }
        description={
          <>
            Business date {summary.data ? formatDate(summary.data.businessDate) : "…"}
            {counts
              ? ` · ${counts.pending} to clean · ${counts.inProgress} in progress · ${counts.unassigned} unassigned · ${counts.completedToday} done today`
              : ""}
          </>
        }
      />

      <ViewNav
        label="Housekeeping views"
        items={tabs}
        value={view}
        onChange={(key) => navigate({ view: key })}
      />

      {view === "board" ? (
        <>
          <ToggleGroup
            label="Room filter"
            options={BOARD_FILTERS}
            value={filter}
            onChange={(value) => navigate({ filter: value })}
          />
          <RoomBoardPanel filter={filter} onClearFilter={() => navigate({ filter: "all" })} />
        </>
      ) : (
        <TaskList view={view} />
      )}

      {adding && businessDate ? (
        <AddTaskDialog
          businessDate={businessDate}
          onClose={() => setAdding(false)}
          onCreated={(task) => {
            setAdding(false);
            // Show the new task where it lives: today's open tasks, or Scheduled.
            navigate({ view: task.scheduledAhead ? "scheduled" : "open" });
          }}
        />
      ) : null}
    </div>
  );
}
