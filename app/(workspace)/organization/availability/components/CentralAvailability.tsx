"use client";

import { skipToken } from "@reduxjs/toolkit/query/react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import {
  type CentralAvailabilityArgs,
  useCentralAvailabilityQuery,
  useOrganizationOverviewQuery,
} from "@/lib/api/endpoints/organization.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { addDays, isDateOnly } from "@/modules/business-date/business-date.policy";
import type { CentralAvailabilityResult } from "@/modules/organization/organization.types";

const STATUS: Record<
  CentralAvailabilityResult["properties"][number]["status"],
  [BadgeTone, string]
> = {
  AVAILABLE: ["success", "Available"],
  UNAVAILABLE: ["warning", "Nothing bookable"],
  NOT_LIVE: ["neutral", "Not live"],
  ARRIVAL_IN_PAST: ["neutral", "Arrival before business date"],
};

const ROOM_STATUS: Record<string, BadgeTone> = {
  AVAILABLE: "success",
  LIMITED: "warning",
  SOLD_OUT: "danger",
  CLOSED: "danger",
  NOT_SUITABLE: "neutral",
};

const toInt = (value: string | null, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

/**
 * Search every accessible property at once (D8). Booking always happens in
 * one property: "Book" hands the stay over to that property's booking
 * workflow, which re-checks availability and price. No cross-property
 * reservations.
 */
export function CentralAvailability() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const overview = useOrganizationOverviewQuery();
  const earliest =
    overview.data?.properties
      .map((p) => p.businessDate)
      .filter((d): d is string => d !== null)
      .sort()[0] ?? null;

  const arrivalParam = params.get("arrival");
  const departureParam = params.get("departure");
  const searched = !!(
    arrivalParam &&
    departureParam &&
    isDateOnly(arrivalParam) &&
    isDateOnly(departureParam)
  );
  const criteria: CentralAvailabilityArgs | null = searched
    ? {
        arrival: arrivalParam!,
        departure: departureParam!,
        adults: Math.max(1, toInt(params.get("adults"), 2)),
        children: toInt(params.get("children"), 0),
        rooms: Math.max(1, toInt(params.get("rooms"), 1)),
      }
    : null;
  const result = useCentralAvailabilityQuery(criteria ?? skipToken);

  const [form, setForm] = useState<Record<keyof CentralAvailabilityArgs, string> | null>(null);
  const defaults = {
    arrival: criteria?.arrival ?? earliest ?? "",
    departure: criteria?.departure ?? (earliest ? addDays(earliest, 1) : ""),
    adults: String(criteria?.adults ?? 2),
    children: String(criteria?.children ?? 0),
    rooms: String(criteria?.rooms ?? 1),
  };
  const values = form ?? defaults;
  const set = (key: keyof CentralAvailabilityArgs) => (e: { target: { value: string } }) =>
    setForm({ ...values, [key]: e.target.value });

  if (overview.isLoading) return <StatusPanel kind="loading" title="Loading" />;
  const error = toClientApiError(result.error);
  const stayQuery = criteria
    ? new URLSearchParams({
        arrival: criteria.arrival,
        departure: criteria.departure,
        adults: String(criteria.adults),
        children: String(criteria.children),
        rooms: String(criteria.rooms),
      }).toString()
    : "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <header>
        <h1 className="text-xl font-semibold">Central availability</h1>
        <p className="text-sm text-fg-secondary">
          Search your properties at once, then book in one of them. Prices are in each
          property&apos;s own currency.
        </p>
      </header>
      <form
        className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border-subtle bg-surface p-3 sm:flex sm:flex-wrap"
        onSubmit={(event) => {
          event.preventDefault();
          router.replace(`${pathname}?${new URLSearchParams(values).toString()}` as Route);
        }}
      >
        <TextField
          label="Arrival"
          type="date"
          value={values.arrival}
          onChange={set("arrival")}
          required
        />
        <TextField
          label="Departure"
          type="date"
          value={values.departure}
          onChange={set("departure")}
          required
        />
        <TextField
          label="Adults"
          type="number"
          min={1}
          max={12}
          value={values.adults}
          onChange={set("adults")}
        />
        <TextField
          label="Children"
          type="number"
          min={0}
          max={12}
          value={values.children}
          onChange={set("children")}
        />
        <TextField
          label="Rooms"
          type="number"
          min={1}
          max={9}
          value={values.rooms}
          onChange={set("rooms")}
        />
        <Button type="submit" size="touch" className="col-span-2 md:h-control md:text-sm">
          Search
        </Button>
      </form>

      {!criteria ? (
        <StatusPanel kind="empty" title="Enter a stay to search" />
      ) : result.isFetching && !result.data ? (
        <StatusPanel kind="loading" title="Searching properties" />
      ) : error ? (
        <StatusPanel
          kind={error.status === 403 ? "forbidden" : "error"}
          title={error.status === 403 ? "Access denied" : "Could not search"}
          description={Object.values(error.fieldErrors).flat()[0] ?? error.message}
          requestId={error.requestId}
        />
      ) : result.data ? (
        <>
          <p className="text-sm text-fg-secondary">
            {formatDate(result.data.arrival)} – {formatDate(result.data.departure)} ·{" "}
            {result.data.nights} {result.data.nights === 1 ? "night" : "nights"} ·{" "}
            {result.data.adults} adults
            {result.data.children ? `, ${result.data.children} children` : ""} · {result.data.rooms}{" "}
            {result.data.rooms === 1 ? "room" : "rooms"}
          </p>
          <ul className="flex flex-col gap-3">
            {result.data.properties.map((row) => {
              const [tone, label] = STATUS[row.status];
              const handoff = row.canBook
                ? `/${row.property.code}/reservations/new?${stayQuery}`
                : `/${row.property.code}/availability?${stayQuery}`;
              return (
                <li
                  key={row.property.id}
                  className="rounded-lg border border-border-subtle bg-surface"
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
                    <h2 className="font-semibold">
                      <span className="me-2 font-mono text-xs text-fg-muted">
                        {row.property.code}
                      </span>
                      {row.property.name}
                    </h2>
                    <Badge tone={tone}>{label}</Badge>
                    <span className="text-xs text-fg-muted">
                      {row.property.currencyCode}
                      {row.businessDate ? ` · business date ${row.businessDate}` : ""}
                    </span>
                    {row.status === "AVAILABLE" || row.status === "UNAVAILABLE" ? (
                      <Link
                        href={handoff as Route}
                        className="ms-auto inline-flex min-h-11 items-center rounded-md bg-brand px-3 text-sm font-medium text-brand-fg hover:bg-brand-hover md:min-h-8"
                      >
                        {row.canBook
                          ? `Book at ${row.property.code}`
                          : `View at ${row.property.code}`}
                      </Link>
                    ) : null}
                  </div>
                  {row.message ? (
                    <p className="px-4 py-3 text-sm text-fg-secondary">{row.message}</p>
                  ) : row.roomTypes.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-fg-secondary">No sellable room types.</p>
                  ) : (
                    <div className="relative overflow-x-auto">
                      <table className="w-full min-w-[480px] text-sm">
                        <caption className="sr-only">Room types at {row.property.name}</caption>
                        <thead className="text-left text-xs text-fg-muted">
                          <tr>
                            <th scope="col" className="px-4 py-2 font-medium">
                              Room type
                            </th>
                            <th scope="col" className="py-2 pe-3 font-medium">
                              Status
                            </th>
                            <th scope="col" className="py-2 pe-3 text-right font-medium">
                              Available
                            </th>
                            <th scope="col" className="py-2 pe-4 text-right font-medium">
                              From (stay)
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                          {row.roomTypes.map((rt) => (
                            <tr key={rt.id}>
                              <th scope="row" className="px-4 py-2 text-left font-medium">
                                <span className="me-2 font-mono text-xs text-fg-muted">
                                  {rt.code}
                                </span>
                                {rt.name}
                              </th>
                              <td className="py-2 pe-3">
                                <Badge tone={ROOM_STATUS[rt.status] ?? "neutral"}>
                                  {rt.status.replace("_", " ").toLowerCase()}
                                </Badge>
                              </td>
                              <td className="py-2 pe-3 text-right tabular-nums">{rt.available}</td>
                              <td className="py-2 pe-4 text-right tabular-nums">
                                {rt.lowestTotal
                                  ? formatCurrency(rt.lowestTotal, row.property.currencyCode)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <ul className="list-disc ps-5 text-xs text-fg-secondary">
            {result.data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
