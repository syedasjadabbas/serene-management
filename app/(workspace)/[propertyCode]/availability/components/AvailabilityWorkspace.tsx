"use client";

import { BedDouble, Ban, CalendarCheck, CalendarRange, Plus, Tag } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AvailabilityResults } from "@/components/reservations/AvailabilityResults";
import { StaySearchForm, type StaySearchValues } from "@/components/reservations/StaySearchForm";
import { Button, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateNavigator } from "@/components/ui/DateNavigator";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useAvailabilityQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, pluralize } from "@/lib/utils/format";
import { parseMoney } from "@/lib/utils/money";
import type { AvailabilityView } from "@/modules/availability/availability.types";
import { addDays, daysBetween } from "@/modules/business-date/business-date.policy";

/**
 * Availability search. Criteria live in the URL (shareable, survive a
 * refresh); without criteria the screen shows the business date, one night,
 * two adults, one room. The date navigator moves the arrival day by day and
 * keeps the length of stay and party.
 */
export function AvailabilityWorkspace() {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const businessDate = useBusinessDate();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const today = businessDate.data?.businessDate ?? null;
  const criteria: StaySearchValues | null = today
    ? {
        arrival: params.get("arrival") ?? today,
        departure: params.get("departure") ?? addDays(params.get("arrival") ?? today, 1),
        adults: Number(params.get("adults") ?? 2),
        children: Number(params.get("children") ?? 0),
        rooms: Number(params.get("rooms") ?? 1),
      }
    : null;

  const availability = useAvailabilityQuery(
    { propertyId: property.id, ...(criteria ?? {}) },
    { skip: !criteria || !can("availability:read") },
  );

  if (permissionsLoading || businessDate.isLoading)
    return <PageSkeleton title="Loading availability" />;
  if (!can("availability:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the availability:read permission to search availability."
      />
    );
  }
  if (!today || !criteria) {
    return (
      <StatusPanel
        kind="empty"
        title="Property not live"
        description="Availability opens once the business date is initialized."
      />
    );
  }

  function search(values: StaySearchValues) {
    const next = new URLSearchParams({
      arrival: values.arrival,
      departure: values.departure,
      adults: String(values.adults),
      children: String(values.children),
      rooms: String(values.rooms),
    });
    router.replace(`${pathname}?${next.toString()}` as Route);
  }

  function moveArrival(arrival: string) {
    const nights = Math.max(1, daysBetween(criteria!.arrival, criteria!.departure));
    search({ ...criteria!, arrival, departure: addDays(arrival, nights) });
  }

  const error = toClientApiError(availability.error);
  const view = availability.data;
  const bookHref = (roomTypeId: string, ratePlanId: string) =>
    `/${property.code}/reservations/new?${new URLSearchParams({
      arrival: criteria.arrival,
      departure: criteria.departure,
      adults: String(criteria.adults),
      children: String(criteria.children),
      rooms: String(criteria.rooms),
      roomTypeId,
      ratePlanId,
    }).toString()}` as Route;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarRange}
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Availability" },
        ]}
        title="Availability"
        description={`Live inventory and bookable rates by room type. Business date ${formatDate(today)}; arrival inclusive, departure exclusive.`}
        actions={
          can("reservations:create") ? (
            <Link
              href={`/${property.code}/reservations/new` as Route}
              className={buttonClass("primary")}
            >
              <Plus aria-hidden="true" className="size-4" />
              New reservation
            </Link>
          ) : null
        }
      />

      <Card title="Stay" description="Dates, party and number of rooms to check.">
        <StaySearchForm
          key={params.toString()}
          initial={criteria}
          businessDate={today}
          onSearch={search}
          pending={availability.isFetching}
        />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateNavigator
          label="Arrival date"
          value={criteria.arrival}
          min={today}
          today={today}
          todayLabel="Business date"
          onChange={moveArrival}
        />
        <p className="text-sm text-fg-secondary" aria-live="polite">
          {view
            ? `${pluralize(view.nights, "night")}, ${formatDate(view.arrival)} → ${formatDate(view.departure)} · ${pluralize(view.adults, "adult")}${
                view.children ? `, ${pluralize(view.children, "child", "children")}` : ""
              } · ${pluralize(view.rooms, "room")}`
            : null}
        </p>
      </div>

      {error ? (
        <StatusPanel
          kind="error"
          title="Could not check availability"
          description={error.message}
          requestId={error.requestId}
          action={
            <Button variant="secondary" onClick={() => void availability.refetch()}>
              Try again
            </Button>
          }
        />
      ) : availability.isLoading || !view ? (
        <div role="status" className="flex flex-col gap-4">
          <span className="sr-only">Checking availability</span>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-lg" />
        </div>
      ) : (
        <>
          <AvailabilitySummary view={view} />
          <AvailabilityResults
            view={view}
            renderRateAction={(roomType, rate) =>
              rate.bookable && roomType.status === "AVAILABLE" && can("reservations:create") ? (
                <Link
                  href={bookHref(roomType.roomType.id, rate.ratePlan.id)}
                  className={buttonClass("primary", "sm")}
                  aria-label={`Book ${roomType.roomType.name}, ${rate.ratePlan.name}`}
                >
                  Book
                </Link>
              ) : null
            }
          />
        </>
      )}
    </div>
  );
}

/** Headline figures for the searched stay, all derived from the response. */
function AvailabilitySummary({ view }: { view: AvailabilityView }) {
  const types = view.roomTypes;
  const available = types.filter((rt) => rt.status === "AVAILABLE" || rt.status === "LIMITED");
  const blocked = types.filter((rt) => rt.status === "SOLD_OUT" || rt.status === "CLOSED");
  const freeRooms = types.reduce((sum, rt) => sum + Math.max(0, rt.available), 0);
  const quotes = types
    .filter((rt) => rt.status === "AVAILABLE")
    .flatMap((rt) => rt.rates)
    .filter((rate) => rate.bookable && rate.total !== null);
  const lowest = quotes.reduce<(typeof quotes)[number] | null>(
    (best, rate) =>
      best === null || parseMoney(rate.total!) < parseMoney(best.total!) ? rate : best,
    null,
  );
  return (
    <section
      aria-label="Availability summary"
      className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
    >
      <StatCard
        icon={CalendarCheck}
        tone="brand"
        label="Room types available"
        value={`${available.length} of ${types.length}`}
        hint="for the whole stay"
      />
      <StatCard
        icon={BedDouble}
        tone="info"
        label="Rooms free"
        value={freeRooms}
        hint="on the tightest night"
      />
      <StatCard
        icon={Ban}
        tone={blocked.length ? "danger" : "neutral"}
        label="Sold out or closed"
        value={blocked.length}
        hint={blocked.length ? blocked.map((rt) => rt.roomType.code).join(", ") : "none"}
      />
      <StatCard
        icon={Tag}
        tone="accent"
        label="Lowest bookable rate"
        value={lowest ? formatCurrency(lowest.total, lowest.currencyCode) : "—"}
        hint={lowest ? `${lowest.ratePlan.code} · stay total` : "no bookable rate"}
      />
    </section>
  );
}
