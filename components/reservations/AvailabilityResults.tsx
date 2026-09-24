"use client";

import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { RoomTypeAvailabilityStatus } from "@/modules/availability/availability.policy";
import type {
  AvailabilityView,
  RateQuoteView,
  RoomTypeAvailabilityView,
} from "@/modules/availability/availability.types";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";

const STATUS: Record<RoomTypeAvailabilityStatus, { label: string; tone: BadgeTone }> = {
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
 * Availability by room type with the inventory figures that produced it
 * (tightest night) and the rate quotes. `renderRateAction` lets the caller
 * add "Select" / "Book" controls.
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
      <p className="py-8 text-center text-sm text-fg-secondary">
        No sellable room types are configured for this property.
      </p>
    );
  }
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border-subtle bg-surface">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">
          Availability for {view.nights} nights from {view.arrival}, {view.rooms} room(s)
        </caption>
        <thead className="bg-surface-sunken text-left text-xs text-fg-secondary">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Room type
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              Inventory
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              Out of order
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              Reserved
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              Tentative
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              Available
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              Requested
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        {view.roomTypes.map((rt) => (
          <tbody key={rt.roomType.id} className="border-t border-border-subtle">
            <tr>
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <span className="font-mono text-xs text-fg-muted">{rt.roomType.code}</span>{" "}
                <span className="font-medium">{rt.roomType.name}</span>
                <span className="block text-xs text-fg-muted">
                  Up to {rt.roomType.maxOccupancy} guests ({rt.roomType.maxAdults} adults,{" "}
                  {rt.roomType.maxChildren} children)
                </span>
              </th>
              <td className="px-2 py-2 text-end tabular-nums">{rt.physical}</td>
              <td className="px-2 py-2 text-end tabular-nums">{rt.outOfOrder}</td>
              <td className="px-2 py-2 text-end tabular-nums">{rt.reserved}</td>
              <td className="px-2 py-2 text-end text-fg-secondary tabular-nums">{rt.tentative}</td>
              <td className="px-2 py-2 text-end font-semibold tabular-nums">{rt.available}</td>
              <td className="px-2 py-2 text-end tabular-nums">{rt.requestedRooms}</td>
              <td className="px-3 py-2">
                <Badge tone={STATUS[rt.status].tone}>{STATUS[rt.status].label}</Badge>
                {rt.restrictions.length > 0 ? (
                  <span className="mt-0.5 block text-xs text-danger">
                    {rt.restrictions.map(restrictionText).join("; ")}
                  </span>
                ) : null}
              </td>
            </tr>
            <tr>
              <td colSpan={8} className="px-3 pb-3">
                <NightStrip roomType={rt} />
                {rt.rates.length > 0 ? (
                  <ul className="mt-2 divide-y divide-border-subtle rounded-md border border-border-subtle">
                    {rt.rates.map((rate) => (
                      <li
                        key={rate.ratePlan.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2.5 py-1.5"
                      >
                        <span className="min-w-40">
                          <span className="font-mono text-xs text-fg-muted">
                            {rate.ratePlan.code}
                          </span>{" "}
                          {rate.ratePlan.name}
                        </span>
                        <span className="tabular-nums">
                          <span className="font-semibold">
                            {formatCurrency(rate.total, rate.currencyCode)}
                          </span>
                          <span className="text-xs text-fg-muted">
                            {" "}
                            total · avg {formatCurrency(rate.averageNightly, rate.currencyCode)}
                          </span>
                        </span>
                        {rate.cancellationPolicy ? (
                          <span className="text-xs text-fg-secondary">
                            Cancellation: {rate.cancellationPolicy.name}
                          </span>
                        ) : null}
                        {!rate.bookable ? (
                          <span className="text-xs text-danger">
                            {rate.unavailableReason === "NOT_PRICED"
                              ? "No price for these dates"
                              : rate.restrictions.map(restrictionText).join("; ")}
                          </span>
                        ) : null}
                        <span className="ms-auto">{renderRateAction?.(rt, rate)}</span>
                      </li>
                    ))}
                  </ul>
                ) : rt.status !== "NOT_SUITABLE" ? (
                  <p className="mt-2 text-xs text-fg-muted">
                    No rate plan is sellable for this room type and stay.
                  </p>
                ) : null}
              </td>
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** Per-night availability, so staff see which night is the constraint. */
function NightStrip({ roomType }: { roomType: RoomTypeAvailabilityView }) {
  return (
    <div
      className="flex flex-wrap gap-1"
      aria-label={`Availability by night for ${roomType.roomType.name}`}
    >
      {roomType.nights.map((night) => (
        <span
          key={night.date}
          title={`${night.date}: ${night.physical} rooms, ${night.outOfOrder} out of order, ${night.sold} reserved, ${night.tentative} tentative`}
          className={
            night.available <= 0
              ? "rounded-sm bg-danger-subtle px-1.5 py-0.5 text-2xs text-danger"
              : night.available < roomType.requestedRooms
                ? "rounded-sm bg-warning-subtle px-1.5 py-0.5 text-2xs text-warning"
                : "rounded-sm bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-secondary"
          }
        >
          {formatShortDate(night.date)}: {night.available}
        </span>
      ))}
    </div>
  );
}
