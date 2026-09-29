"use client";

import { CalendarCheck, CalendarRange, Plus } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { THead, Table, TableFrame, Th } from "@/components/ui/Table";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  RESERVATION_FILTER_KEYS,
  ReservationFilters,
  type ReservationFilterValues,
} from "./ReservationFilters";
import { ReservationResultsPage } from "./ReservationResultsPage";

/**
 * Server-side reservation search with URL-synced filters and cursor
 * pagination. Wide screens (xl) get a table; phones, tablets and small laptops get stacked rows
 * with the same facts (guest, state, dates, confirmation, room, total).
 */
export function ReservationSearch() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = Object.fromEntries(
    RESERVATION_FILTER_KEYS.map((key) => [key, params.get(key) ?? undefined]),
  ) as ReservationFilterValues;
  const filterKey = params.toString();
  // Cursors of the pages loaded so far; reset whenever the filters change.
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key: filterKey,
    cursors: [undefined],
  });
  const cursors = pages.key === filterKey ? pages.cursors : [undefined];

  if (isLoading) return <PageSkeleton title="Loading reservations" />;
  if (!can("reservations:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the reservations:read permission."
      />
    );
  }

  function apply(values: ReservationFilterValues) {
    const next = new URLSearchParams();
    for (const key of RESERVATION_FILTER_KEYS) {
      const value = values[key];
      if (value) next.set(key, value);
    }
    router.replace((next.size ? `${pathname}?${next.toString()}` : pathname) as Route);
  }

  const pageProps = (cursor: string | undefined, index: number) => ({
    propertyId: property.id,
    propertyCode: property.code,
    filters,
    cursor,
    isLast: index === cursors.length - 1,
    onLoadMore: (next: string) => setPages({ key: filterKey, cursors: [...cursors, next] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarCheck}
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Reservations" },
        ]}
        title="Reservations"
        description="Find any reservation by confirmation number, guest or room, and open it to act on it."
        actions={
          <>
            {can("availability:read") ? (
              <Link
                href={`/${property.code}/availability` as Route}
                className={buttonClass("secondary")}
              >
                <CalendarRange aria-hidden="true" className="size-4" />
                Availability
              </Link>
            ) : null}
            {can("reservations:create") ? (
              <Link
                href={`/${property.code}/reservations/new` as Route}
                className={buttonClass("primary")}
              >
                <Plus aria-hidden="true" className="size-4" />
                New reservation
              </Link>
            ) : null}
          </>
        }
      />
      <ReservationFilters
        key={filterKey}
        propertyId={property.id}
        initial={filters}
        onApply={apply}
      />

      <section
        aria-label="Reservations matching the filters"
        className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-card xl:hidden"
      >
        <ul className="divide-y divide-border-subtle">
          {cursors.map((cursor, index) => (
            <ReservationResultsPage
              key={cursor ?? "first"}
              variant="list"
              {...pageProps(cursor, index)}
            />
          ))}
        </ul>
      </section>

      <TableFrame label="Reservations" className="hidden xl:block">
        <Table caption="Reservations matching the filters" minWidth="60rem">
          <THead>
            <tr>
              <Th>Confirmation</Th>
              <Th>Guest</Th>
              <Th>Stay</Th>
              <Th>Room</Th>
              <Th>Rate · source</Th>
              <Th numeric>Total</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Open</span>
              </Th>
            </tr>
          </THead>
          {cursors.map((cursor, index) => (
            <ReservationResultsPage
              key={cursor ?? "first"}
              variant="table"
              {...pageProps(cursor, index)}
            />
          ))}
        </Table>
      </TableFrame>
    </div>
  );
}
