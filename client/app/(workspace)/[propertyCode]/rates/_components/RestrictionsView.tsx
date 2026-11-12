"use client";

import { useState } from "react";
import { Badge } from "@/global/components/ui/Badge";
import { Button } from "@/global/components/ui/Button";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { TextField } from "@/global/components/ui/TextField";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";
import { useRateOptionsQuery, useRestrictionsQuery } from "@/global/api/endpoints/ratesApi";
import { toClientApiError } from "@/global/api/errors";
import { formatShortDate } from "@serene/shared/lib/utils/format";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import { RESTRICTION_LABELS } from "./RateCalendarPanel";
import { RestrictionDialog } from "./RestrictionDialog";

/**
 * Restrictions over a date range. Every applicable restriction (house, room
 * type, rate plan, or both) is enforced by the availability engine for search,
 * quotes and booking alike.
 */
export function RestrictionsView() {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  // The restrictions API is gated by availability:read, not the tab's rates:read.
  const canRead = can("availability:read");
  const options = useRateOptionsQuery(property.id);
  const optionsError = toClientApiError(options.error);
  const [from, setFrom] = useState("");
  const start = from || options.data?.businessDate || "";
  const query = useRestrictionsQuery(
    { propertyId: property.id, from: start, to: start ? addDays(start, 30) : "" },
    { skip: !start || !canRead },
  );
  const error = toClientApiError(query.error);
  const [editing, setEditing] = useState(false);
  // `currentData` belongs to the current period only; never show another period's rows.
  const rows = query.currentData;
  const loading =
    !optionsError && !error && (options.isLoading || !start || (query.isFetching && !rows));
  const byDate = new Map<string, NonNullable<typeof rows>>();
  for (const row of rows ?? [])
    byDate.set(row.stayDate, [...(byDate.get(row.stayDate) ?? []), row]);

  if (permissionsLoading) return <StatusPanel kind="loading" title="Loading restrictions" />;
  if (!canRead)
    return (
      <StatusPanel
        kind="forbidden"
        title="Restrictions unavailable"
        description="You need the availability:read permission to see restrictions."
      />
    );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="From"
          type="date"
          value={start}
          onChange={(e) => setFrom(e.target.value)}
        />
        <p className="pb-2 text-xs text-fg-muted">Next 31 days</p>
        {can("availability:manage") ? (
          <Button className="ms-auto" onClick={() => setEditing(true)}>
            Set or clear restrictions
          </Button>
        ) : null}
      </div>
      {optionsError ? (
        <StatusPanel
          kind="error"
          title="Could not load the business date"
          description={optionsError.message}
          requestId={optionsError.requestId}
          action={
            <Button variant="secondary" onClick={() => void options.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {loading ? <StatusPanel kind="loading" title="Loading restrictions" /> : null}
      {error ? (
        <StatusPanel
          kind="error"
          title="Could not load restrictions"
          description={error.message}
          requestId={error.requestId}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {query.isSuccess && rows && rows.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="No restrictions in this period"
          description="Every plan is open for sale."
        />
      ) : null}
      {byDate.size > 0 ? (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface shadow-card">
          {[...byDate].map(([date, list]) => (
            <li key={date} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <span className="w-28 text-sm font-medium">{formatShortDate(date)}</span>
              {list.map((r) => (
                <Badge key={r.id} tone={r.type === "CLOSED" ? "danger" : "warning"}>
                  {RESTRICTION_LABELS[r.type] ?? r.type}
                  {r.value !== null ? ` ${r.value}` : ""}
                  {" · "}
                  {[r.roomType?.code, r.ratePlan?.code].filter(Boolean).join(" / ") || "house"}
                </Badge>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? <RestrictionDialog start={start} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}
