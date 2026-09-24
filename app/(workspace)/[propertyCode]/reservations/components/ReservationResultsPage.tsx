"use client";

import Link from "next/link";
import type { Route } from "next";
import { BookingStateBadge } from "@/components/reservations/BookingStateBadge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useReservationsQuery } from "@/lib/api/endpoints/reservations.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { ReservationFilterValues } from "./ReservationFilters";

const PAGE_SIZE = 50;

/** One cursor page of results; the last page offers "Load more". */
export function ReservationResultsPage({
  propertyId,
  propertyCode,
  filters,
  cursor,
  isLast,
  onLoadMore,
}: {
  propertyId: string;
  propertyCode: string;
  filters: ReservationFilterValues;
  cursor: string | undefined;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
}) {
  const { data, isLoading, isFetching, error, refetch } = useReservationsQuery({
    propertyId,
    ...filters,
    cursor,
    limit: String(PAGE_SIZE),
  });
  const apiError = toClientApiError(error);

  if (isLoading) {
    return (
      <tbody>
        <tr>
          <td colSpan={11} className="px-3 py-6 text-center">
            <Spinner label="Loading reservations" />
          </td>
        </tr>
      </tbody>
    );
  }
  if (apiError) {
    return (
      <tbody>
        <tr>
          <td colSpan={11} className="px-3 py-6 text-center text-sm text-danger">
            {apiError.message}{" "}
            <Button size="sm" variant="secondary" onClick={() => void refetch()}>
              Retry
            </Button>
          </td>
        </tr>
      </tbody>
    );
  }
  if (!data || (data.items.length === 0 && !cursor)) {
    return (
      <tbody>
        <tr>
          <td colSpan={11} className="px-3 py-8 text-center text-sm text-fg-secondary">
            No reservations match these filters.
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
      {data.items.map((item) => (
        <tr key={item.reservationRoomId} className="hover:bg-surface-sunken/60">
          <td className="px-3 py-1.5">
            <Link
              href={`/${propertyCode}/reservations/${item.reservationId}` as Route}
              className="font-mono text-sm font-medium text-brand hover:underline"
            >
              {item.displayConfirmation}
            </Link>
          </td>
          <td className="px-2 py-1.5">
            {item.guest.name}
            {item.guest.isVip ? (
              <span className="ms-1 text-2xs font-semibold text-accent">VIP</span>
            ) : null}
          </td>
          <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(item.arrival)}</td>
          <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(item.departure)}</td>
          <td className="px-2 py-1.5 text-end tabular-nums">{item.nights}</td>
          <td className="px-2 py-1.5">
            <span className="font-mono text-xs">{item.roomType.code}</span>
          </td>
          <td className="px-2 py-1.5 font-mono text-xs">{item.room?.number ?? "—"}</td>
          <td className="px-2 py-1.5 text-end tabular-nums">
            {item.adults}
            {item.children ? `+${item.children}` : ""}
          </td>
          <td className="px-2 py-1.5 font-mono text-xs">{item.ratePlan.code}</td>
          <td className="px-2 py-1.5 text-end whitespace-nowrap tabular-nums">
            {formatCurrency(item.totalAmount, item.currencyCode)}
          </td>
          <td className="px-3 py-1.5">
            <BookingStateBadge state={item.bookingState} />
          </td>
        </tr>
      ))}
      {isLast && data.meta.nextCursor ? (
        <tr>
          <td colSpan={11} className="px-3 py-2 text-center">
            <Button
              variant="secondary"
              size="sm"
              pending={isFetching}
              onClick={() => onLoadMore(data.meta.nextCursor!)}
            >
              Load more
            </Button>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}
