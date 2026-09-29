"use client";

import { Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useBusinessDate } from "@/hooks/useBusinessDate";
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
import { TrendCard } from "./dashboard/TrendCard";

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

  if (businessDate.isLoading) return <DashboardSkeleton />;
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
          ? "Initialize its first business date to go live."
          : "An administrator must initialize its first business date."
      }`,
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
    { label: "Business date status", value: bd?.status ?? "—" },
    {
      label: "Property local date and time",
      value: bd ? `${bd.propertyLocalDate} ${bd.propertyLocalTime}` : "—",
      mono: true,
    },
    { label: "Time zone", value: property.timezone, mono: true },
    { label: "Currency", value: property.currencyCode, mono: true },
    { label: "Your permissions here", value: String(permissionCount) },
  ];

  const showOperations = housekeepingAllowed || maintenanceAllowed;
  const main = [
    frontDeskAllowed ? (
      <ArrivalsCard
        key="arrivals"
        propertyId={property.id}
        propertyCode={property.code}
        canOpenReservation={can("reservations:read")}
      />
    ) : null,
    view ? <TrendCard key="trend" trend={view.trend} /> : null,
  ].filter(Boolean);
  const side = [
    view ? <RoomStatusCard key="rooms" rooms={view.rooms} href={roomsHref} /> : null,
    view ? <LastClosedCard key="closed" view={view} propertyCode={property.code} /> : null,
    showOperations ? (
      <OperationsCard
        key="operations"
        propertyId={property.id}
        propertyCode={property.code}
        housekeeping={housekeepingAllowed}
        maintenance={maintenanceAllowed}
      />
    ) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: property.code }, { label: "Dashboard" }]}
        title={property.name}
        meta={status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        description={
          bd?.businessDate
            ? `Business date ${formatDate(bd.businessDate)} · property time ${bd.propertyLocalTime} (${property.timezone})`
            : `Property time ${bd?.propertyLocalTime ?? "—"} (${property.timezone})`
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

      {main.length || side.length ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          {main.length ? (
            <div
              className={
                side.length
                  ? "flex min-w-0 flex-col gap-6 lg:col-span-2"
                  : "flex min-w-0 flex-col gap-6 lg:col-span-3"
              }
            >
              {main}
            </div>
          ) : null}
          {side.length ? (
            <div
              className={
                main.length
                  ? "flex min-w-0 flex-col gap-6"
                  : "grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2 lg:col-span-3 lg:grid-cols-3"
              }
            >
              {side}
            </div>
          ) : null}
        </div>
      ) : null}

      <PropertyDetailsCard facts={facts} />
    </div>
  );
}

function StatSkeletons() {
  return (
    <div role="status" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <span className="sr-only">Loading today&apos;s figures</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 rounded-lg border border-border-subtle bg-surface p-4">
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

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3 w-80" />
      </div>
      <StatSkeletons />
    </div>
  );
}
