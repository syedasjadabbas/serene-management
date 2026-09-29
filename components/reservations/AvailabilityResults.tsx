"use client";

import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import type { RoomTypeAvailabilityStatus } from "@/modules/availability/availability.policy";
import type {
  AvailabilityView,
  RateQuoteView,
  RoomTypeAvailabilityView,
} from "@/modules/availability/availability.types";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";

export const AVAILABILITY_STATUS: Record<
  RoomTypeAvailabilityStatus,
  { label: string; tone: BadgeTone }
> = {
  AVAILABLE: { label: "Available", tone: "success" },
  LIMITED: { label: "Limited", tone: "warning" },
  SOLD_OUT: { label: "Sold out", tone: "danger" },
  CLOSED: { label: "Closed", tone: "danger" },
  NOT_SUITABLE: { label: "Party too large", tone: "neutral" },
};

const RESTRICTION_LABELS: Record<string, string> = {
  CLOSED: "Closed",
  CLOSED_TO_ARRIVAL: "Closed to arrival",
  CLOSED_TO_DEPARTURE: "Closed to departure",
  MIN_LOS: "Minimum stay",
  MAX_LOS: "Maximum stay",
  MIN_STAY_THROUGH: "Minimum stay-through",
  MAX_STAY_THROUGH: "Maximum stay-through",
  MIN_ADVANCE_DAYS: "Minimum advance",
  MAX_ADVANCE_DAYS: "Maximum advance",
};

export function restrictionText(r: { type: string; date: string; value: number | null }) {
  return `${RESTRICTION_LABELS[r.type] ?? r.type}${r.value !== null ? ` ${r.value}` : ""} (${r.date})`;
}

/**
 * Availability by room type: status, the inventory figures of the tightest
 * night, availability per night, and the rate quotes. Each room type is a
 * row group that reads the same on phones and desktops (no wide table to
 * scroll). `renderRateAction` lets the caller add "Select" / "Book".
 */
export function AvailabilityResults({
  view,
  renderRateAction,
}: {
  view: AvailabilityView;
  renderRateAction?: (roomType: RoomTypeAvailabilityView, rate: RateQuoteView) => ReactNode;
}) {
  if (view.roomTypes.length === 0) {
    return (
      <p className="rounded-lg border border-border-subtle bg-surface px-4 py-10 text-center text-sm text-fg-secondary">
        No sellable room types are configured for this property.
      </p>
    );
  }
  return (
    <ul
      aria-label={`Availability for ${view.nights} nights from ${view.arrival}, ${view.rooms} room(s)`}
      className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-card"
    >
      {view.roomTypes.map((rt) => (
        <RoomTypeRow key={rt.roomType.id} roomType={rt} renderRateAction={renderRateAction} />
      ))}
    </ul>
  );
}

function RoomTypeRow({
  roomType: rt,
  renderRateAction,
}: {
  roomType: RoomTypeAvailabilityView;
  renderRateAction?: (roomType: RoomTypeAvailabilityView, rate: RateQuoteView) => ReactNode;
}) {
  const status = AVAILABILITY_STATUS[rt.status];
  const headingId = `rt-${rt.roomType.id}`;
  const figures: [string, number, string?][] = [
    ["Inventory", rt.physical],
    ["Out of order", rt.outOfOrder],
    ["Reserved", rt.reserved],
    ["Tentative", rt.tentative],
    ["Requested", rt.requestedRooms],
    [
      "Available",
      rt.available,
      rt.available <= 0
        ? "text-danger"
        : rt.available < rt.requestedRooms
          ? "text-warning"
          : "text-brand",
    ],
  ];
  return (
    <li>
      <section aria-labelledby={headingId} className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h3
              id={headingId}
              className="flex flex-wrap items-center gap-2 text-base font-semibold"
            >
              <span className="rounded-[5px] bg-surface-sunken px-1.5 font-mono text-xs text-fg-secondary">
                {rt.roomType.code}
              </span>
              {rt.roomType.name}
              <Badge tone={status.tone}>{status.label}</Badge>
            </h3>
            <p className="mt-1 text-xs text-fg-secondary">
              Up to {rt.roomType.maxOccupancy} guests · {rt.roomType.maxAdults} adults,{" "}
              {rt.roomType.maxChildren} children
            </p>
            {rt.restrictions.length > 0 ? (
              <p className="mt-1 text-xs text-danger">
                {rt.restrictions.map(restrictionText).join("; ")}
              </p>
            ) : null}
          </div>
          <dl className="grid grid-cols-3 gap-x-5 gap-y-2 sm:grid-cols-6">
            {figures.map(([label, value, tone]) => (
              <div key={label} className="min-w-0">
                <dt className="text-2xs whitespace-nowrap text-fg-muted">{label}</dt>
                <dd className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <NightStrip roomType={rt} />

        {rt.rates.length > 0 ? (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {rt.rates.map((rate) => (
              <li
                key={rate.ratePlan.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 basis-48">
                  <span className="font-mono text-xs text-fg-muted">{rate.ratePlan.code}</span>{" "}
                  <span className="font-medium">{rate.ratePlan.name}</span>
                  {rate.cancellationPolicy ? (
                    <span className="block text-xs text-fg-secondary">
                      Cancellation: {rate.cancellationPolicy.name}
                    </span>
                  ) : null}
                  {!rate.bookable ? (
                    <span className="block text-xs text-danger">
                      {rate.unavailableReason === "NOT_PRICED"
                        ? "No price for these dates"
                        : rate.restrictions.map(restrictionText).join("; ")}
                    </span>
                  ) : null}
                </span>
                <span className="text-end tabular-nums">
                  <span className="block font-semibold">
                    {formatCurrency(rate.total, rate.currencyCode)}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    avg {formatCurrency(rate.averageNightly, rate.currencyCode)} / night
                  </span>
                </span>
                {renderRateAction ? (
                  <span className="shrink-0">{renderRateAction(rt, rate)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : rt.status !== "NOT_SUITABLE" ? (
          <p className="text-xs text-fg-muted">
            No rate plan is sellable for this room type and stay.
          </p>
        ) : null}
      </section>
    </li>
  );
}

/**
 * Rooms free per night, so staff see which night is the constraint. The
 * number is always shown; colour only reinforces it (sold out, fewer than
 * requested).
 */
function NightStrip({ roomType }: { roomType: RoomTypeAvailabilityView }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-fg-secondary">Rooms free per night</p>
      <ul
        aria-label={`Rooms free per night for ${roomType.roomType.name}`}
        className="flex flex-wrap gap-1.5"
      >
        {roomType.nights.map((night) => {
          const short = night.available <= 0;
          const tight = !short && night.available < roomType.requestedRooms;
          return (
            <li
              key={night.date}
              title={`${night.date}: ${night.physical} rooms, ${night.outOfOrder} out of order, ${night.sold} reserved, ${night.tentative} tentative`}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-[5px] border px-2 text-xs tabular-nums",
                short && "border-danger/30 bg-danger-subtle text-danger",
                tight && "border-warning/30 bg-warning-subtle text-warning",
                !short && !tight && "border-border-subtle bg-surface-sunken text-fg-secondary",
              )}
            >
              <span>{formatShortDate(night.date)}</span>
              <span className="font-semibold text-fg">{night.available}</span>
              {short ? <span className="sr-only">(sold out)</span> : null}
              {tight ? <span className="sr-only">(fewer than requested)</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
