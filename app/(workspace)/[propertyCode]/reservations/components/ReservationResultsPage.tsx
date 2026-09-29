"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { BookingStateBadge } from "@/components/reservations/BookingStateBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { TableEmpty, Td, Tr } from "@/components/ui/Table";
import { useReservationsQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatShortDate, pluralize } from "@/lib/utils/format";
import type { ReservationListItem } from "@/modules/reservations/reservations.types";
import type { ReservationFilterValues } from "./ReservationFilters";

const PAGE_SIZE = 50;
export const RESULT_COLUMNS = 8;

/**
 * One cursor page of results, rendered either as table rows (xl and up) or
 * as stacked rows (phones and tablets). Both variants read the same cached
 * query, so showing both costs one request. The last page offers "Load more".
 */
export function ReservationResultsPage({
  variant,
  propertyId,
  propertyCode,
  filters,
  cursor,
  isLast,
  hasFilters,
  onClearFilters,
  onLoadMore,
}: {
  variant: "table" | "list";
  propertyId: string;
  propertyCode: string;
  filters: ReservationFilterValues;
  cursor: string | undefined;
  isLast: boolean;
  /** Whether any narrowing filter is set (sort alone is not one). */
  hasFilters: boolean;
  onClearFilters: () => void;
  onLoadMore: (cursor: string) => void;
}) {
  // currentData is only ever for these exact arguments, never a previous query's rows.
  const {
    currentData: data,
    isFetching,
    error,
    refetch,
  } = useReservationsQuery({
    propertyId,
    ...filters,
    cursor,
    limit: String(PAGE_SIZE),
  });
  const apiError = toClientApiError(error);
  const href = (item: ReservationListItem) =>
    `/${propertyCode}/reservations/${item.reservationId}` as Route;

  const message = (content: React.ReactNode, tone: "muted" | "danger" = "muted") =>
    variant === "table" ? (
      <tbody>
        <TableEmpty colSpan={RESULT_COLUMNS}>
          <span className={tone === "danger" ? "text-danger" : undefined}>{content}</span>
        </TableEmpty>
      </tbody>
    ) : (
      <li
        className={`px-4 py-10 text-center text-sm ${tone === "danger" ? "text-danger" : "text-fg-secondary"}`}
      >
        {content}
      </li>
    );

  // No rows for these exact arguments yet: loading, never the previous query.
  if (!data && !apiError) {
    return variant === "table" ? (
      <tbody className="divide-y divide-border-subtle">
        {Array.from({ length: 6 }, (_, row) => (
          <tr key={row}>
            {Array.from({ length: RESULT_COLUMNS }, (_, column) => (
              <Td key={column}>
                {row === 0 && column === 0 ? (
                  <span role="status" className="sr-only">
                    Loading reservations
                  </span>
                ) : null}
                <Skeleton className={column === 1 ? "w-32" : "w-16"} />
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    ) : (
      <li>
        <SkeletonRows rows={4} columns={3} label="Loading reservations" />
      </li>
    );
  }
  if (apiError) {
    return message(
      <>
        {apiError.message}{" "}
        <Button size="sm" variant="secondary" onClick={() => void refetch()}>
          Try again
        </Button>
      </>,
      "danger",
    );
  }
  if (!data) return null;
  if (data.items.length === 0 && !cursor) {
    return message(
      hasFilters ? (
        <>
          No reservations match these filters.{" "}
          <Button size="sm" variant="secondary" onClick={onClearFilters}>
            Clear filters
          </Button>
        </>
      ) : (
        "No reservations yet."
      ),
    );
  }

  // Hidden while this page refreshes so a stale cursor is never appended.
  const more =
    isLast && data.meta.nextCursor && !isFetching ? (
      <Button variant="secondary" size="sm" onClick={() => onLoadMore(data.meta.nextCursor!)}>
        Load more
      </Button>
    ) : null;

  if (variant === "list") {
    return (
      <>
        {data.items.map((item) => (
          <li key={item.reservationRoomId}>
            <Link
              href={href(item)}
              className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-sunken/60"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-fg">{item.guest.name}</span>
                    {item.guest.isVip ? <Badge tone="accent">VIP</Badge> : null}
                  </span>
                  <BookingStateBadge state={item.bookingState} />
                </div>
                <p className="text-sm text-fg">
                  {formatShortDate(item.arrival)} → {formatShortDate(item.departure)}
                  <span className="text-fg-secondary"> · {pluralize(item.nights, "night")}</span>
                </p>
                <p className="flex flex-wrap gap-x-2 text-xs text-fg-secondary">
                  <span className="font-mono">{item.displayConfirmation}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.room ? `Room ${item.room.number}` : "Unassigned"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.roomType.name}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {formatCurrency(item.totalAmount, item.currencyCode)}
                  </span>
                </p>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-fg-muted rtl:rotate-180"
              />
            </Link>
          </li>
        ))}
        {more ? <li className="px-4 py-3 text-center">{more}</li> : null}
      </>
    );
  }

  return (
    <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
      {data.items.map((item) => (
        <Tr key={item.reservationRoomId} interactive>
          <Td>
            <Link
              href={href(item)}
              className="font-mono text-sm font-medium text-brand hover:underline"
            >
              {item.displayConfirmation}
            </Link>
          </Td>
          <Td>
            <span className="flex items-center gap-2">
              <span className="font-medium">{item.guest.name}</span>
              {item.guest.isVip ? <Badge tone="accent">VIP</Badge> : null}
            </span>
          </Td>
          <Td className="whitespace-nowrap">
            {formatShortDate(item.arrival)} → {formatShortDate(item.departure)}
            <span className="block text-xs text-fg-secondary">
              {pluralize(item.nights, "night")} · {pluralize(item.adults + item.children, "guest")}
            </span>
          </Td>
          <Td>
            {item.room ? (
              <span className="font-mono font-medium">{item.room.number}</span>
            ) : (
              <span className="text-fg-secondary">Unassigned</span>
            )}
            <span className="block text-xs text-fg-secondary" title={item.roomType.code}>
              {item.roomType.name}
            </span>
          </Td>
          <Td>
            <span className="font-mono text-xs">{item.ratePlan.code}</span>
            <span className="block text-xs text-fg-secondary">
              {item.source.code}
              {item.channel ? ` · ${item.channel.code}` : ""}
            </span>
          </Td>
          <Td numeric className="whitespace-nowrap">
            {formatCurrency(item.totalAmount, item.currencyCode)}
          </Td>
          <Td>
            <BookingStateBadge state={item.bookingState} />
          </Td>
          <Td className="w-10 pe-2">
            <Link
              href={href(item)}
              aria-label={`Open reservation ${item.displayConfirmation}`}
              className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken hover:text-fg"
            >
              <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
            </Link>
          </Td>
        </Tr>
      ))}
      {more ? (
        <tr>
          <td colSpan={RESULT_COLUMNS} className="px-3 py-3 text-center">
            {more}
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}
