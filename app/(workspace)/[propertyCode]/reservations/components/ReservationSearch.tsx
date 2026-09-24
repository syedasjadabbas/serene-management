"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { ReservationFilters, type ReservationFilterValues } from "./ReservationFilters";
import { ReservationResultsPage } from "./ReservationResultsPage";

const FILTER_KEYS = [
  "q",
  "state",
  "arrivalFrom",
  "arrivalTo",
  "createdFrom",
  "createdTo",
  "sort",
] as const;

/** Server-side reservation search with URL-synced filters and cursor pagination. */
export function ReservationSearch() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = Object.fromEntries(
    FILTER_KEYS.map((key) => [key, params.get(key) ?? undefined]),
  ) as ReservationFilterValues;
  const filterKey = params.toString();
  // Cursors of the pages loaded so far; reset whenever the filters change.
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key: filterKey,
    cursors: [undefined],
  });
  const cursors = pages.key === filterKey ? pages.cursors : [undefined];

  if (isLoading) return <StatusPanel kind="loading" title="Loading reservations" />;
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
    for (const key of FILTER_KEYS) {
      const value = values[key];
      if (value) next.set(key, value);
    }
    router.replace((next.size ? `${pathname}?${next.toString()}` : pathname) as Route);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Reservations</h1>
        {can("reservations:create") ? (
          <Link
            href={`/${property.code}/reservations/new` as Route}
            className="inline-flex h-control items-center rounded-md bg-brand px-3 text-sm font-medium text-brand-fg hover:bg-brand-hover"
          >
            New reservation
          </Link>
        ) : null}
      </header>
      <ReservationFilters key={filterKey} initial={filters} onApply={apply} />
      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <caption className="sr-only">Reservations matching the filters</caption>
          <thead className="bg-surface-sunken text-left text-xs text-fg-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Confirmation
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Guest
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Arrival
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Departure
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                Nights
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Room type
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Room
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                Guests
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Rate
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                Total
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                State
              </th>
            </tr>
          </thead>
          {cursors.map((cursor, index) => (
            <ReservationResultsPage
              key={cursor ?? "first"}
              propertyId={property.id}
              propertyCode={property.code}
              filters={filters}
              cursor={cursor}
              isLast={index === cursors.length - 1}
              onLoadMore={(next) => setPages({ key: filterKey, cursors: [...cursors, next] })}
            />
          ))}
        </table>
      </div>
    </div>
  );
}
