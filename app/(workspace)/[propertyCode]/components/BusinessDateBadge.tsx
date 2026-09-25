"use client";

import Link from "next/link";
import type { Route } from "next";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { cn } from "@/components/ui/cn";

/**
 * Header indicator of the hotel business date (server value, never the
 * browser date). Users who can read the night audit get a link to it; the
 * badge flags an audit that is due, overdue or running.
 */
export function BusinessDateBadge() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
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
  const due = data.sync?.state === "AWAITING_AUDIT";
  const className = cn(
    "flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs",
    overdue ? "bg-danger-subtle text-danger" : "bg-surface-sunken text-fg-secondary",
  );
  const content = (
    <>
      <span className="text-fg-muted">Business date</span>
      <span className="font-mono font-medium text-fg">{data.businessDate}</span>
      {data.status === "IN_AUDIT" ? (
        <span className="text-warning">· Night audit running</span>
      ) : null}
      {overdue ? <span>· Audit overdue</span> : null}
      {due && data.status !== "IN_AUDIT" ? (
        <span className="text-fg-muted">· Audit due</span>
      ) : null}
    </>
  );
  const title = `Property time ${data.propertyLocalDate} ${data.propertyLocalTime} (${data.timezone})`;
  return can("nightaudit:read") ? (
    <Link
      href={`/${property.code}/night-audit` as Route}
      title={title}
      className={cn(className, "hover:underline")}
    >
      {content}
    </Link>
  ) : (
    <span title={title} className={className}>
      {content}
    </span>
  );
}
