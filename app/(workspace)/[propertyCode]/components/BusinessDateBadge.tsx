"use client";

import { useBusinessDate } from "@/hooks/useBusinessDate";
import { cn } from "@/components/ui/cn";

/** Header indicator of the hotel business date (server value, never the browser date). */
export function BusinessDateBadge() {
  const { data, isLoading, isError } = useBusinessDate();

  if (isLoading) return <span className="text-xs text-fg-muted">Business date…</span>;
  if (isError || !data)
    return <span className="text-xs text-danger">Business date unavailable</span>;
  if (data.status === "NOT_INITIALIZED") {
    return (
      <span className="rounded-sm bg-warning-subtle px-2 py-0.5 text-xs text-warning">
        Not live
      </span>
    );
  }

  const overdue = data.sync?.state === "AUDIT_OVERDUE";
  return (
    <span
      title={`Property time ${data.propertyLocalDate} ${data.propertyLocalTime} (${data.timezone})`}
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs",
        overdue ? "bg-danger-subtle text-danger" : "bg-surface-sunken text-fg-secondary",
      )}
    >
      <span className="text-fg-muted">Business date</span>
      <span className="font-mono font-medium text-fg">{data.businessDate}</span>
      {data.status === "IN_AUDIT" ? (
        <span className="text-warning">· Night audit running</span>
      ) : null}
      {overdue ? <span>· Audit overdue</span> : null}
    </span>
  );
}
