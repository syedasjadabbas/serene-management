"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useFrontDeskSummaryQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate } from "@/lib/utils/format";
import { ArrivalsView } from "./ArrivalsView";
import { POLL_MS } from "./constants";
import { ListToolbar } from "./ListToolbar";
import { RoomBoardView } from "./RoomBoardView";
import { StaysView } from "./StaysView";

type View = "arrivals" | "in-house" | "departures" | "rooms";

const FILTERS: Record<View, { value: string; label: string }[]> = {
  arrivals: [
    { value: "all", label: "All" },
    { value: "pending", label: "Not checked in" },
    { value: "unassigned", label: "No room" },
    { value: "assigned", label: "Room assigned" },
    { value: "checked_in", label: "Checked in" },
    { value: "vip", label: "VIP" },
  ],
  "in-house": [
    { value: "all", label: "All" },
    { value: "arrived_today", label: "Arrived today" },
    { value: "due_out", label: "Due out" },
  ],
  departures: [
    { value: "all", label: "All" },
    { value: "due_out", label: "Due out" },
    { value: "departed", label: "Departed today" },
  ],
  rooms: [
    { value: "all", label: "All" },
    { value: "vacant_ready", label: "Vacant · ready" },
    { value: "vacant_not_ready", label: "Vacant · not ready" },
    { value: "occupied", label: "Occupied" },
    { value: "out_of_order", label: "Out of order" },
    { value: "arriving", label: "Arrival assigned" },
  ],
};

const isView = (value: string | null): value is View =>
  value === "arrivals" || value === "in-house" || value === "departures" || value === "rooms";

/**
 * Front desk workspace for the property's business date: arrivals, guests in
 * house, departures and the room board. The view, filter and search live in
 * the URL; every list is paginated and filtered on the server.
 */
export function FrontDeskWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = can("frontdesk:read");
  const summary = useFrontDeskSummaryQuery(property.id, {
    skip: !allowed,
    pollingInterval: POLL_MS,
    skipPollingIfUnfocused: true,
  });
  const summaryError = toClientApiError(summary.error);

  const view: View = isView(params.get("view")) ? (params.get("view") as View) : "arrivals";
  const filter = FILTERS[view].some((f) => f.value === params.get("filter"))
    ? params.get("filter")!
    : "all";
  const q = params.get("q") ?? "";

  if (isLoading) return <StatusPanel kind="loading" title="Loading front desk" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the frontdesk:read permission."
      />
    );
  }
  if (summaryError?.code === "BUSINESS_RULE_VIOLATION") {
    return (
      <StatusPanel
        kind="empty"
        title="Property not live"
        description="The front desk opens once the business date is initialized."
      />
    );
  }

  function navigate(next: { view?: View; filter?: string; q?: string }) {
    const search = new URLSearchParams();
    const nextView = next.view ?? view;
    if (nextView !== "arrivals") search.set("view", nextView);
    const nextFilter = next.view && next.view !== view ? "all" : (next.filter ?? filter);
    if (nextFilter !== "all") search.set("filter", nextFilter);
    const nextQ = next.view && next.view !== view ? "" : (next.q ?? q);
    if (nextQ && nextView !== "rooms") search.set("q", nextQ);
    router.replace((search.size ? `${pathname}?${search.toString()}` : pathname) as Route);
  }

  const counts = summary.data;
  const tabs: { key: View; label: string; count: number | undefined; detail?: string }[] = [
    {
      key: "arrivals",
      label: "Arrivals",
      count: counts?.arrivals.total,
      detail: counts ? `${counts.arrivals.pending} to check in` : undefined,
    },
    {
      key: "in-house",
      label: "In house",
      count: counts?.inHouse.total,
      detail: counts ? `${counts.inHouse.arrivedToday} arrived today` : undefined,
    },
    {
      key: "departures",
      label: "Departures",
      count: counts ? counts.departures.dueOut + counts.departures.departed : undefined,
      detail: counts ? `${counts.departures.dueOut} due out` : undefined,
    },
    {
      key: "rooms",
      label: "Rooms",
      count: counts?.rooms.total,
      detail: counts
        ? `${counts.rooms.VACANT_READY} ready · ${counts.rooms.VACANT_NOT_READY} not ready`
        : undefined,
    },
  ];
  const canWalkIn = can("reservations:create") && can("frontdesk:checkin") && can("rooms:assign");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Front desk</h1>
          <p className="text-xs text-fg-muted">
            Business date {counts ? formatDate(counts.businessDate) : "…"}
          </p>
        </div>
        {canWalkIn ? (
          <Link
            href={`/${property.code}/reservations/new?walkIn=1` as Route}
            className="inline-flex h-control items-center rounded-md bg-brand px-3 text-sm font-medium text-brand-fg hover:bg-brand-hover"
          >
            Walk-in
          </Link>
        ) : null}
      </header>

      <nav aria-label="Front desk views">
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {tabs.map((tab) => (
            <li key={tab.key}>
              <button
                type="button"
                aria-current={view === tab.key ? "page" : undefined}
                onClick={() => navigate({ view: tab.key })}
                className={cn(
                  "flex w-full flex-col items-start rounded-lg border px-3 py-2 text-start",
                  view === tab.key
                    ? "border-brand bg-brand-subtle"
                    : "border-border-subtle bg-surface hover:bg-surface-sunken",
                )}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{tab.label}</span>
                  <span className="text-lg font-semibold tabular-nums">{tab.count ?? "–"}</span>
                </span>
                <span className="text-xs text-fg-muted">{tab.detail ?? " "}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <ListToolbar
        key={`${view}-${q}`}
        filters={FILTERS[view]}
        filter={filter}
        q={q}
        searchable={view !== "rooms"}
        onFilter={(value) => navigate({ filter: value })}
        onSearch={(value) => navigate({ q: value })}
      />

      {view === "arrivals" ? <ArrivalsView filter={filter} q={q} /> : null}
      {view === "in-house" ? <StaysView kind="in-house" filter={filter} q={q} /> : null}
      {view === "departures" ? <StaysView kind="departures" filter={filter} q={q} /> : null}
      {view === "rooms" ? <RoomBoardView filter={filter} /> : null}
    </div>
  );
}
