"use client";

import { LayoutDashboard, Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { useBusinessDate, usePropertyClock } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { toClientApiError } from "@/lib/api/errors";
import { useFrontDeskSummaryQuery } from "@/lib/api/endpoints/front-desk.api";
import { useMaintenanceSummaryQuery } from "@/lib/api/endpoints/maintenance.api";
import { useDashboardQuery } from "@/lib/api/endpoints/reports.api";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { formatDate } from "@/lib/utils/format";
import { ArrivalsCard } from "./dashboard/ArrivalsCard";
import { type AttentionItem, AttentionCard } from "./dashboard/AttentionCard";
import { LastClosedCard } from "./dashboard/LastClosedCard";
import { OperationsCard } from "./dashboard/OperationsCard";
import { PropertyDetailsCard } from "./dashboard/PropertyDetailsCard";
import { RoomStatusCard } from "./dashboard/RoomStatusCard";
import { StatsRow } from "./dashboard/StatsRow";
import { TrendCard, hasTrend } from "./dashboard/TrendCard";

const SYNC_TEXT = {
  IN_SYNC: "Business date matches the property calendar.",
  AWAITING_AUDIT: "Past local midnight: the business date advances when night audit runs.",
  AUDIT_OVERDUE: "Night audit is overdue: the business date is more than one day behind.",
  AHEAD: "The business date is ahead of the property calendar. Check the property time zone.",
} as const;

const STATUS_BADGE = {
  OPEN: { tone: "success", label: "Open" },
  IN_AUDIT: { tone: "info", label: "Night audit running" },
  NOT_INITIALIZED: { tone: "warning", label: "Not live" },
} as const;

/**
 * Property dashboard (docs/NGINAP_UI_MAPPING.md §15). Every section is
 * gated by the permission its data needs and its query is skipped
 * otherwise, so the page never asks the server for something the user may
 * not see: KPIs, room status, trend and closed-date figures need
 * dashboard:read; arrivals frontdesk:read; operations housekeeping:read /
 * maintenance:read. Property facts are visible to every member.
 */
export function PropertyOverview() {
  const property = useProperty();
  const { data: me } = useMeQuery();
  const businessDate = useBusinessDate();
  const clock = usePropertyClock(businessDate.data, businessDate.fulfilledTimeStamp);
  const { can } = usePermissions(property.id);
  const live = Boolean(businessDate.data?.businessDate);

  const dashboardAllowed = live && can("dashboard:read");
  const frontDeskAllowed = live && can("frontdesk:read");
  const housekeepingAllowed = can("housekeeping:read");
  const maintenanceAllowed = can("maintenance:read");

  // Paused while the tab is hidden or unfocused, refreshed on return (B10).
  const dashboard = useDashboardQuery(property.id, {
    skip: !dashboardAllowed,
    pollingInterval: 120_000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
  const frontDesk = useFrontDeskSummaryQuery(property.id, {
    skip: !frontDeskAllowed,
    pollingInterval: 120_000,
    skipPollingIfUnfocused: true,
  });
  const maintenance = useMaintenanceSummaryQuery(property.id, {
    skip: !maintenanceAllowed,
    pollingInterval: 120_000,
    skipPollingIfUnfocused: true,
  });

  if (businessDate.isLoading) {
    return <PageSkeleton title="Loading dashboard" />;
  }
  if (businessDate.isError) {
    const error = toClientApiError(businessDate.error);
    return (
      <StatusPanel
        kind={error?.code === "FORBIDDEN" ? "forbidden" : "error"}
        title={error?.code === "FORBIDDEN" ? "Access denied" : "Could not load the property"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          <Button variant="secondary" onClick={() => void businessDate.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const bd = businessDate.data;
  const base = `/${property.code}`;
  const view = dashboard.data;
  const dashboardError = toClientApiError(dashboard.error);
  const canWalkIn = can("reservations:create") && can("frontdesk:checkin") && can("rooms:assign");
  const permissionCount = me?.properties.find((p) => p.id === property.id)?.permissions.length ?? 0;
  const status = bd ? STATUS_BADGE[bd.status] : null;

  const attention: AttentionItem[] = [];
  if (bd?.status === "NOT_INITIALIZED") {
    attention.push({
      id: "not-live",
      tone: "warning",
      message: `This property is not live yet. ${
        can("properties:manage")
          ? "Set up its rooms and rates, then open its first business date."
          : "An administrator opens its first business date once the rooms and rates are set up."
      }`,
      href: can("settings:read") ? (`${base}/setup` as Route) : null,
      linkLabel: "Property setup",
    });
  }
  if (bd?.status === "IN_AUDIT") {
    attention.push({
      id: "in-audit",
      tone: "info",
      message: "Night audit is running. Postings wait until it finishes.",
      href: can("nightaudit:read") ? (`${base}/night-audit` as Route) : null,
      linkLabel: "Night audit",
    });
  }
  if (bd?.sync && bd.sync.state !== "IN_SYNC") {
    attention.push({
      id: "sync",
      tone: bd.sync.state === "AUDIT_OVERDUE" ? "danger" : "warning",
      message: SYNC_TEXT[bd.sync.state],
      href: can("nightaudit:read") ? (`${base}/night-audit` as Route) : null,
      linkLabel: "Night audit",
    });
  }
  const unassigned = frontDesk.data?.arrivals.unassigned ?? 0;
  if (unassigned > 0) {
    attention.push({
      id: "unassigned",
      tone: "warning",
      message: `${unassigned} ${unassigned === 1 ? "arrival has" : "arrivals have"} no room assigned.`,
      href: `${base}/front-desk?view=arrivals&filter=unassigned` as Route,
      linkLabel: "Assign rooms",
    });
  }
  const blocking = maintenance.data?.blockingRooms ?? 0;
  if (blocking > 0) {
    attention.push({
      id: "blocking",
      tone: "warning",
      message: `${blocking} ${blocking === 1 ? "room is" : "rooms are"} blocked by open maintenance.`,
      href: `${base}/maintenance` as Route,
      linkLabel: "Maintenance",
    });
  }
  if (view && view.rooms.outOfOrder > 0) {
    attention.push({
      id: "ooo",
      tone: "info",
      message: `${view.rooms.outOfOrder} ${
        view.rooms.outOfOrder === 1 ? "room is" : "rooms are"
      } out of order.`,
      href: housekeepingAllowed ? (`${base}/housekeeping` as Route) : null,
      linkLabel: "Room board",
    });
  }

  const roomsHref: Route | null = housekeepingAllowed
    ? (`${base}/housekeeping` as Route)
    : view?.access.reports
      ? (`${base}/reports/room-status` as Route)
      : null;
  const facts = [
    { label: "Business date", value: bd?.businessDate ?? "Not initialized", mono: true },
    {
      label: "Business date status",
      value: bd?.status
        ? bd.status.charAt(0) + bd.status.slice(1).toLowerCase().replaceAll("_", " ")
        : "—",
    },
    {
      label: "Local date and time",
      value: clock ? `${clock.date} ${clock.time}` : "—",
      mono: true,
    },
    { label: "Time zone", value: property.timezone, mono: true },
    { label: "Currency", value: property.currencyCode, mono: true },
    { label: "Your permissions", value: String(permissionCount) },
  ];

  const showOperations = housekeepingAllowed || maintenanceAllowed;
  const trendReady = view ? hasTrend(view.trend) : false;
  const arrivals = frontDeskAllowed ? (
    <ArrivalsCard
      propertyId={property.id}
      propertyCode={property.code}
      canOpenReservation={can("reservations:read")}
    />
  ) : null;
  const roomStatus = view ? <RoomStatusCard rooms={view.rooms} href={roomsHref} /> : null;
  const lastClosed = view ? <LastClosedCard view={view} propertyCode={property.code} /> : null;
  const operations = showOperations ? (
    <OperationsCard
      propertyId={property.id}
      propertyCode={property.code}
      housekeeping={housekeepingAllowed}
      maintenance={maintenanceAllowed}
    />
  ) : null;

  // The workspace reads top-down in the order front-office staff need it:
  // what needs attention, today's figures, today's arrivals beside the room
  // picture, then the last close and open work. With a trend (two or more
  // closed dates) the chart pairs with the last close; without one it is a
  // single line and the last close, operations and property facts share a
  // row of three. Sections the user may not see give their space away.
  const rows: ReactNode[][] = trendReady
    ? [
        [arrivals, roomStatus],
        [<TrendCard key="trend" trend={view!.trend} />, lastClosed],
        [<PropertyDetailsCard key="facts" facts={facts} />, operations],
      ]
    : [
        [arrivals, roomStatus],
        [view ? <TrendCard key="trend" trend={view.trend} /> : null],
        [lastClosed, operations, <PropertyDetailsCard key="facts" facts={facts} compact />],
      ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={LayoutDashboard}
        breadcrumbs={[{ label: property.code }, { label: "Dashboard" }]}
        title={property.name}
        meta={status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        description={
          bd?.businessDate
            ? `Business date ${formatDate(bd.businessDate)} · property time ${clock?.time ?? "—"} (${property.timezone})`
            : `Property time ${clock?.time ?? "—"} (${property.timezone})`
        }
        actions={
          <>
            {canWalkIn ? (
              <Link
                href={`${base}/reservations/new?walkIn=1` as Route}
                className={buttonClass("secondary")}
              >
                <UserPlus aria-hidden="true" className="size-4" />
                Walk-in
              </Link>
            ) : null}
            {can("reservations:create") ? (
              <Link href={`${base}/reservations/new` as Route} className={buttonClass("primary")}>
                <Plus aria-hidden="true" className="size-4" />
                New reservation
              </Link>
            ) : null}
          </>
        }
      />

      <AttentionCard items={attention} />

      {dashboardAllowed ? (
        dashboard.isLoading ? (
          <StatSkeletons />
        ) : view ? (
          <StatsRow view={view} propertyCode={property.code} />
        ) : (
          <StatusPanel
            kind={dashboardError?.status === 403 ? "forbidden" : "error"}
            title={
              dashboardError?.status === 403
                ? "No dashboard access"
                : "Could not load today's figures"
            }
            description={dashboardError?.message}
            requestId={dashboardError?.requestId}
            action={
              <Button variant="secondary" onClick={() => void dashboard.refetch()}>
                Try again
              </Button>
            }
          />
        )
      ) : null}

      {rows.map((row, index) => (
        <DashboardRow key={index} cells={row} />
      ))}
    </div>
  );
}

/**
 * One dashboard row. Two cells pair as two-thirds and one-third (the
 * operational list beside its summary), three share the width equally, one
 * spans it; from lg, below which they stack. Cells stretch to the row's
 * height so paired cards end on the same line.
 */
function DashboardRow({ cells }: { cells: ReactNode[] }) {
  const visible = cells.filter(Boolean);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {visible.map((cell, index) => (
        <div
          key={index}
          className={cn(
            "flex min-w-0 flex-col [&>*]:flex-1",
            visible.length === 1 && "lg:col-span-3",
            visible.length === 2 && index === 0 && "lg:col-span-2",
          )}
        >
          {cell}
        </div>
      ))}
    </div>
  );
}

function StatSkeletons() {
  return (
    <div role="status" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <span className="sr-only">Loading today&apos;s figures</span>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex gap-3 rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6"
        >
          <Skeleton className="size-10 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}
