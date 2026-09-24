"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AvailabilityResults } from "@/components/reservations/AvailabilityResults";
import { StaySearchForm, type StaySearchValues } from "@/components/reservations/StaySearchForm";
import { Alert } from "@/components/ui/Alert";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useAvailabilityQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { addDays } from "@/modules/business-date/business-date.policy";
import { pluralize } from "@/lib/utils/format";

/** Availability search: criteria live in the URL so results are shareable and survive refresh. */
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
  const searched = params.has("arrival");

  const availability = useAvailabilityQuery(
    { propertyId: property.id, ...(criteria ?? {}) },
    { skip: !criteria || !searched || !can("availability:read") },
  );

  if (permissionsLoading || businessDate.isLoading)
    return <StatusPanel kind="loading" title="Loading availability" />;
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

  const error = toClientApiError(availability.error);
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
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Availability</h1>
        <p className="text-xs text-fg-muted">
          Business date {today} · arrival inclusive, departure exclusive
        </p>
      </header>
      <section className="rounded-lg border border-border-subtle bg-surface p-3">
        <StaySearchForm
          key={params.toString()}
          initial={criteria}
          businessDate={today}
          onSearch={search}
          pending={availability.isFetching}
        />
      </section>
      {error ? (
        <Alert tone="danger">
          {error.message}
          {error.requestId ? (
            <span className="block font-mono text-2xs">Reference: {error.requestId}</span>
          ) : null}
        </Alert>
      ) : null}
      {!searched ? (
        <StatusPanel
          kind="empty"
          title="Search availability"
          description="Choose the stay dates and party, then search."
        />
      ) : availability.isLoading ? (
        <StatusPanel kind="loading" title="Checking availability" />
      ) : availability.data ? (
        <>
          <p className="text-sm text-fg-secondary">
            {pluralize(availability.data.nights, "night")} from {availability.data.arrival} to{" "}
            {availability.data.departure}, {pluralize(availability.data.adults, "adult")}
            {availability.data.children
              ? `, ${pluralize(availability.data.children, "child", "children")}`
              : ""}
            , {pluralize(availability.data.rooms, "room")}.
          </p>
          <AvailabilityResults
            view={availability.data}
            renderRateAction={(roomType, rate) =>
              rate.bookable && roomType.status === "AVAILABLE" && can("reservations:create") ? (
                <Link
                  href={bookHref(roomType.roomType.id, rate.ratePlan.id)}
                  className="inline-flex h-7 items-center rounded-md bg-brand px-2.5 text-xs font-medium text-brand-fg hover:bg-brand-hover"
                >
                  Book
                </Link>
              ) : null
            }
          />
        </>
      ) : null}
    </div>
  );
}
