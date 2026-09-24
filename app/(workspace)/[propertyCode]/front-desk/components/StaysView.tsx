"use client";

import Link from "next/link";
import type { Route } from "next";
import { type ReactNode, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useDeparturesQuery, useInHouseQuery } from "@/lib/api/endpoints/front-desk.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDateTime, formatShortDate } from "@/lib/utils/format";
import type { StayDetail, StayRow } from "@/modules/front-desk/front-desk.types";
import { CheckOutDialog } from "./CheckOutDialog";
import { POLL_MS } from "./constants";
import { useCursorPages } from "./useCursorPages";

const PAGE_SIZE = 50;
const COLUMNS = 8;

type Kind = "in-house" | "departures";

function stayState(row: StayRow): { label: string; tone: BadgeTone } {
  if (row.stayStatus === "CHECKED_OUT") return { label: "Departed", tone: "neutral" };
  switch (row.checkoutTiming) {
    case "ON_TIME":
      return { label: "Due out", tone: "warning" };
    case "OVERSTAY":
      return { label: "Overstay", tone: "danger" };
    default:
      return { label: "In house", tone: "success" };
  }
}

/** In-house guests, or departures (due out and departed on the business date). */
export function StaysView({ kind, filter, q }: { kind: Kind; filter: string; q: string }) {
  const { cursors, loadMore } = useCursorPages(`${kind}|${filter}|${q}`);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [done, setDone] = useState<StayDetail | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {done ? (
        <Alert tone="success">
          {done.guest.name} checked out of room {done.room.number}; the room is now vacant and
          marked for cleaning.
        </Alert>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <caption className="sr-only">
            {kind === "in-house" ? "Guests in house" : "Departures for the business date"}
          </caption>
          <thead className="bg-surface-sunken text-left text-xs text-fg-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Room
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Guest
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Confirmation
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Stay
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                Guests
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                {kind === "departures" ? "Checked out" : "Checked in"}
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {cursors.map((cursor, index) => (
            <StaysPage
              key={cursor ?? "first"}
              kind={kind}
              filter={filter}
              q={q}
              cursor={cursor}
              isLast={index === cursors.length - 1}
              onLoadMore={loadMore}
              onCheckOut={(stayId) => {
                setDone(null);
                setCheckingOut(stayId);
              }}
            />
          ))}
        </table>
      </div>
      {checkingOut ? (
        <CheckOutDialog
          key={checkingOut}
          open
          stayId={checkingOut}
          onClose={() => setCheckingOut(null)}
          onCheckedOut={setDone}
        />
      ) : null}
    </div>
  );
}

function StaysPage({
  kind,
  filter,
  q,
  cursor,
  isLast,
  onLoadMore,
  onCheckOut,
}: {
  kind: Kind;
  filter: string;
  q: string;
  cursor: string | undefined;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
  onCheckOut: (stayId: string) => void;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const args = {
    propertyId: property.id,
    filter,
    q: q || undefined,
    cursor,
    limit: String(PAGE_SIZE),
  };
  const polling = { pollingInterval: cursor ? 0 : POLL_MS, skipPollingIfUnfocused: true };
  const inHouse = useInHouseQuery(args, { ...polling, skip: kind !== "in-house" });
  const departures = useDeparturesQuery(args, { ...polling, skip: kind !== "departures" });
  const { data, isLoading, isFetching, error, refetch } =
    kind === "in-house" ? inHouse : departures;
  const apiError = toClientApiError(error);

  if (isLoading) return <MessageRow>{<Spinner label="Loading guests" />}</MessageRow>;
  if (apiError) {
    return (
      <MessageRow tone="danger">
        {apiError.message}{" "}
        <Button size="sm" variant="secondary" onClick={() => void refetch()}>
          Retry
        </Button>
      </MessageRow>
    );
  }
  if (!data || (data.items.length === 0 && !cursor)) {
    return (
      <MessageRow>
        {q || filter !== "all"
          ? "No guests match."
          : kind === "in-house"
            ? "No guests in house."
            : "No departures for the business date."}
      </MessageRow>
    );
  }

  const canCheckOut = can("frontdesk:checkout");
  return (
    <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
      {data.items.map((row) => {
        const state = stayState(row);
        const checkOutReady =
          row.stayStatus === "IN_HOUSE" &&
          (row.checkoutTiming === "ON_TIME" || row.checkoutTiming === "OVERSTAY");
        return (
          <tr key={row.stayId} className="align-top hover:bg-surface-sunken/60">
            <td className="px-3 py-2 font-mono text-sm font-medium">
              {row.room.number}
              <span className="ms-1 text-xs text-fg-muted">{row.roomType.code}</span>
            </td>
            <td className="px-2 py-2">
              <span className="font-medium">{row.guest.name}</span>
              {row.guest.vip ? (
                <span className="ms-1 text-2xs font-semibold text-accent">VIP {row.guest.vip}</span>
              ) : null}
              {row.latestNote ? (
                <p
                  className="mt-0.5 line-clamp-1 max-w-64 text-xs text-fg-muted"
                  title={row.latestNote}
                >
                  {row.latestNote}
                </p>
              ) : null}
            </td>
            <td className="px-2 py-2">
              <Link
                href={`/${property.code}/reservations/${row.reservationId}` as Route}
                className="font-mono text-sm text-brand hover:underline"
              >
                {row.confirmation}
              </Link>
            </td>
            <td className="px-2 py-2 whitespace-nowrap">
              {formatShortDate(row.arrival)} → {formatShortDate(row.departure)}
              <span className="ms-1 text-xs text-fg-muted">{row.nights}n</span>
            </td>
            <td className="px-2 py-2 text-end tabular-nums">
              {row.adults}
              {row.children ? `+${row.children}` : ""}
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap text-fg-secondary">
              {kind === "in-house"
                ? formatDateTime(row.checkedInAt, property.timezone)
                : row.checkedOutAt
                  ? formatDateTime(row.checkedOutAt, property.timezone)
                  : "—"}
            </td>
            <td className="px-2 py-2">
              <Badge tone={state.tone}>{state.label}</Badge>
            </td>
            <td className="px-3 py-2 text-end whitespace-nowrap">
              <span className="inline-flex items-center gap-2">
                <Link
                  href={`/${property.code}/front-desk/stays/${row.stayId}` as Route}
                  className="text-sm text-brand hover:underline"
                >
                  Open stay
                </Link>
                {canCheckOut && checkOutReady ? (
                  <Button size="sm" onClick={() => onCheckOut(row.stayId)}>
                    Check out
                  </Button>
                ) : null}
              </span>
            </td>
          </tr>
        );
      })}
      {isLast && data.meta.nextCursor ? (
        <tr>
          <td colSpan={COLUMNS} className="px-3 py-2 text-center">
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

function MessageRow({ children, tone }: { children: ReactNode; tone?: "danger" }) {
  return (
    <tbody>
      <tr>
        <td
          colSpan={COLUMNS}
          className={`px-3 py-8 text-center text-sm ${tone === "danger" ? "text-danger" : "text-fg-secondary"}`}
        >
          {children}
        </td>
      </tr>
    </tbody>
  );
}
