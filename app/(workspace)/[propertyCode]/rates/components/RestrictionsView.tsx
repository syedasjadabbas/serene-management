"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog, WeekdayPicker } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useRateOptionsQuery,
  useRestrictionsQuery,
  useSetRestrictionsMutation,
} from "@/lib/api/endpoints/rates.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatShortDate } from "@/lib/utils/format";
import { RESTRICTION_TYPES, VALUED_RESTRICTIONS } from "@/modules/availability/availability.schema";
import { addDays } from "@/modules/business-date/business-date.policy";
import { RESTRICTION_LABELS } from "./RateCalendarPanel";

/**
 * Restrictions over a date range. Every applicable restriction (house, room
 * type, rate plan, or both) is enforced by the availability engine for search,
 * quotes and booking alike.
 */
export function RestrictionsView() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const options = useRateOptionsQuery(property.id);
  const [from, setFrom] = useState("");
  const start = from || options.data?.businessDate || "";
  const query = useRestrictionsQuery(
    { propertyId: property.id, from: start, to: start ? addDays(start, 30) : "" },
    { skip: !start },
  );
  const error = toClientApiError(query.error);
  const [editing, setEditing] = useState(false);
  const rows = query.data ?? [];
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) byDate.set(row.stayDate, [...(byDate.get(row.stayDate) ?? []), row]);

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
          <Button size="touch" className="ms-auto" onClick={() => setEditing(true)}>
            Set or clear restrictions
          </Button>
        ) : null}
      </div>
      {query.isLoading ? <StatusPanel kind="loading" title="Loading restrictions" /> : null}
      {error ? (
        <StatusPanel kind="error" title="Could not load restrictions" description={error.message} />
      ) : null}
      {!query.isLoading && !error && rows.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="No restrictions in this period"
          description="Every plan is open for sale."
        />
      ) : null}
      {byDate.size > 0 ? (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface">
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

function RestrictionDialog({ start, onClose }: { start: string; onClose: () => void }) {
  const property = useProperty();
  const options = useRateOptionsQuery(property.id);
  const [save, state] = useSetRestrictionsMutation();
  const [action, setAction] = useState<"set" | "clear">("set");
  const [type, setType] = useState<(typeof RESTRICTION_TYPES)[number]>("CLOSED_TO_ARRIVAL");
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(start);
  const [days, setDays] = useState(127);
  const [roomTypeId, setRoomTypeId] = useState("");
  const [ratePlanId, setRatePlanId] = useState("");
  const [value, setValue] = useState("2");
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const valued = VALUED_RESTRICTIONS.has(type);

  return (
    <FormDialog
      title="Restrictions"
      description="Applies to every stay date in the range on the chosen weekdays."
      onClose={onClose}
      onSubmit={async () => {
        const result = await save({
          propertyId: property.id,
          body: {
            action,
            type,
            from,
            to,
            daysOfWeek: days,
            roomTypeId: roomTypeId || null,
            ratePlanId: ratePlanId || null,
            value: action === "set" && valued ? Number.parseInt(value, 10) : null,
            reason: reason.trim(),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel={action === "set" ? "Apply" : "Clear"}
      danger={action === "clear"}
      disabled={!from || !to || days === 0 || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Action"
          options={[
            { value: "set", label: "Set" },
            { value: "clear", label: "Clear" },
          ]}
          value={action}
          onChange={(e) => setAction(e.target.value as "set" | "clear")}
        />
        <Select
          label="Restriction"
          options={RESTRICTION_TYPES.map((t) => ({ value: t, label: RESTRICTION_LABELS[t] ?? t }))}
          value={type}
          onChange={(e) => setType(e.target.value as (typeof RESTRICTION_TYPES)[number])}
        />
        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          errors={error?.fieldErrors.to}
        />
        <Select
          label="Room type"
          placeholder="All room types"
          options={(options.data?.roomTypes ?? []).map((rt) => ({ value: rt.id, label: rt.code }))}
          value={roomTypeId}
          onChange={(e) => setRoomTypeId(e.target.value)}
        />
        <Select
          label="Rate plan"
          placeholder="All rate plans"
          options={(options.data?.ratePlans ?? []).map((p) => ({ value: p.id, label: p.code }))}
          value={ratePlanId}
          onChange={(e) => setRatePlanId(e.target.value)}
        />
        {action === "set" && valued ? (
          <TextField
            label={type.includes("ADVANCE") ? "Days" : "Nights"}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
            errors={error?.fieldErrors.value}
          />
        ) : null}
      </div>
      <WeekdayPicker value={days} onChange={setDays} />
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
    </FormDialog>
  );
}
