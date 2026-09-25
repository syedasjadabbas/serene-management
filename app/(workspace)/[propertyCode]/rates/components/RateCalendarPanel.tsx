"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import { useRateCalendarQuery, useRateOptionsQuery } from "@/lib/api/endpoints/rates.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";
import { addDays } from "@/modules/business-date/business-date.policy";

export const RESTRICTION_LABELS: Record<string, string> = {
  CLOSED: "Closed",
  CLOSED_TO_ARRIVAL: "CTA",
  CLOSED_TO_DEPARTURE: "CTD",
  MIN_LOS: "Min stay",
  MAX_LOS: "Max stay",
  MIN_STAY_THROUGH: "Min stay-through",
  MAX_STAY_THROUGH: "Max stay-through",
  MIN_ADVANCE_DAYS: "Min advance",
  MAX_ADVANCE_DAYS: "Max advance",
};

/**
 * Day-by-day prices of one plan and room type as the booking engine
 * computes them, with the restrictions that apply to that plan and room type.
 */
export function RateCalendarPanel({ initialPlanId }: { initialPlanId?: string }) {
  const property = useProperty();
  const options = useRateOptionsQuery(property.id);
  const o = options.data;
  const [planId, setPlanId] = useState(initialPlanId ?? "");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [from, setFrom] = useState("");
  const start = from || o?.businessDate || "";
  const plan = planId || o?.ratePlans.find((p) => p.status === "ACTIVE")?.id || "";
  const roomType = roomTypeId || o?.roomTypes[0]?.id || "";
  const query = useRateCalendarQuery(
    {
      propertyId: property.id,
      ratePlanId: plan,
      roomTypeId: roomType,
      from: start,
      to: start ? addDays(start, 27) : "",
    },
    { skip: !plan || !roomType || !start },
  );
  const error = toClientApiError(query.error);
  const data = query.data;
  const money = (value: string | null) =>
    value === null ? "—" : formatCurrency(value, property.currencyCode, "en", o?.minorUnits);

  return (
    <section className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Rate plan"
          options={(o?.ratePlans ?? []).map((p) => ({
            value: p.id,
            label: `${p.code} · ${p.name}`,
          }))}
          value={plan}
          onChange={(e) => setPlanId(e.target.value)}
        />
        <Select
          label="Room type"
          options={(o?.roomTypes ?? []).map((rt) => ({
            value: rt.id,
            label: `${rt.code} · ${rt.name}`,
          }))}
          value={roomType}
          onChange={(e) => setRoomTypeId(e.target.value)}
        />
        <TextField
          label="From"
          type="date"
          value={start}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      {query.isLoading || options.isLoading ? (
        <StatusPanel kind="loading" title="Loading prices" />
      ) : null}
      {error ? (
        <StatusPanel kind="error" title="Could not load the calendar" description={error.message} />
      ) : null}
      {data ? (
        <div className="relative overflow-x-auto rounded-lg border border-border-subtle bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">
              Prices of {data.ratePlan.code} for {data.roomType.code}
            </caption>
            <thead className="bg-surface-sunken text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Night
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Season
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  1 adult
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  2 adults
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Restrictions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {data.days.map((day) => (
                <tr key={day.date}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatShortDate(day.date)}</td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {day.seasonName ?? (data.ratePlan.derived ? "from parent" : "no season")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(day.oneAdult)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(day.twoAdults)}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {day.restrictions.map((r, i) => (
                        <Badge key={i} tone={r.type === "CLOSED" ? "danger" : "warning"}>
                          {RESTRICTION_LABELS[r.type] ?? r.type}
                          {r.value !== null ? ` ${r.value}` : ""}
                          {r.scope === "HOUSE" ? " · house" : ""}
                        </Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
