"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useBusinessDate, usePropertyClock } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { cn } from "@/components/ui/cn";

const FIELD =
  "inline-flex h-10 items-center gap-2 rounded-md border bg-surface px-3 text-xs whitespace-nowrap shadow-card";

/**
 * Header indicator of the hotel business date (server value, never the
 * browser date): a squared field with the date, and after a divider the
 * night-audit state when it needs attention (running, due, overdue). Only
 * an overdue audit turns the field red. Users who can read the night audit
 * get a link to it.
 */
export function BusinessDateBadge() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  // The header is on every page: it also refetches the date after local midnight.
  const { data, isLoading, isError, fulfilledTimeStamp } = useBusinessDate({ rollover: true });
  const clock = usePropertyClock(data, fulfilledTimeStamp);

  if (isLoading) return <span className="text-xs text-fg-muted">Business date…</span>;
  if (isError || !data)
    return <span className="text-xs text-danger">Business date unavailable</span>;
  if (data.status === "NOT_INITIALIZED") {
    return (
      <span className={cn(FIELD, "border-warning/30 font-medium text-warning")}>Not live</span>
    );
  }

  const overdue = data.sync?.state === "AUDIT_OVERDUE";
  const due = data.sync?.state === "AWAITING_AUDIT" && data.status !== "IN_AUDIT";
  const running = data.status === "IN_AUDIT";
  const state = overdue
    ? { tone: "text-danger", dot: "bg-danger", short: "Overdue", long: "Audit overdue" }
    : running
      ? { tone: "text-info", dot: "bg-info", short: "Running", long: "Audit running" }
      : due
        ? { tone: "text-warning", dot: "bg-warning", short: "Due", long: "Audit due" }
        : null;

  const content = (
    <>
      <CalendarDays
        aria-hidden="true"
        className="hidden size-3.5 shrink-0 text-fg-muted sm:block"
      />
      <span className="hidden label-caps min-[87.5rem]:inline">Business date</span>
      <span className="font-mono text-sm font-semibold text-fg">{data.businessDate}</span>
      {state ? (
        <>
          <span aria-hidden="true" className="h-3.5 w-px bg-border" />
          <span className={cn("inline-flex items-center gap-1.5 font-medium", state.tone)}>
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", state.dot)} />
            <span className="sr-only">{state.short}</span>
            <span className="hidden sm:inline">{state.long}</span>
          </span>
        </>
      ) : null}
    </>
  );
  const className = cn(FIELD, overdue ? "border-danger/35" : "border-border");
  const title = `Property time ${clock?.date ?? data.propertyLocalDate} ${clock?.time ?? data.propertyLocalTime} (${data.timezone})`;
  return can("nightaudit:read") ? (
    <Link
      href={`/${property.code}/night-audit` as Route}
      title={title}
      className={cn(className, "transition-colors duration-150 hover:bg-surface-sunken")}
    >
      {content}
    </Link>
  ) : (
    <span title={title} className={className}>
      {content}
    </span>
  );
}
