"use client";

import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { toClientApiError } from "@/lib/api/errors";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { DashboardPanel } from "./DashboardPanel";

const SYNC_TEXT = {
  IN_SYNC: "Business date matches the property calendar.",
  AWAITING_AUDIT: "Past local midnight: the business date advances when night audit runs.",
  AUDIT_OVERDUE: "Night audit is overdue: the business date is more than one day behind.",
  AHEAD: "The business date is ahead of the property calendar. Check the property time zone.",
} as const;

export function PropertyOverview() {
  const property = useProperty();
  const { data: me } = useMeQuery();
  const businessDate = useBusinessDate();
  const { can } = usePermissions(property.id);
  const permissionCount = me?.properties.find((p) => p.id === property.id)?.permissions.length ?? 0;

  if (businessDate.isLoading) return <StatusPanel kind="loading" title="Loading property" />;
  if (businessDate.isError) {
    const error = toClientApiError(businessDate.error);
    return (
      <StatusPanel
        kind={error?.code === "FORBIDDEN" ? "forbidden" : "error"}
        title={error?.code === "FORBIDDEN" ? "Access denied" : "Could not load the property"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          <Button variant="secondary" onClick={() => void businessDate.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  const view = businessDate.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <p className="font-mono text-xs text-fg-muted">{property.code}</p>
        <h1 className="text-xl font-semibold">{property.name}</h1>
      </div>

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-3">
        <Fact label="Business date" value={view?.businessDate ?? "Not initialized"} mono />
        <Fact label="Business date status" value={view?.status ?? "—"} />
        <Fact
          label="Property local date and time"
          value={view ? `${view.propertyLocalDate} ${view.propertyLocalTime}` : "—"}
          mono
        />
        <Fact label="Time zone" value={property.timezone} mono />
        <Fact label="Currency" value={property.currencyCode} mono />
        <Fact label="Your permissions here" value={String(permissionCount)} />
      </dl>

      {view?.sync ? (
        <p className="text-sm text-fg-secondary">{SYNC_TEXT[view.sync.state]}</p>
      ) : null}
      {view?.businessDate && can("dashboard:read") ? <DashboardPanel /> : null}
      {view?.status === "NOT_INITIALIZED" ? (
        <p className="text-sm text-fg-secondary">
          This property is not live yet.{" "}
          {can("properties:manage")
            ? "Initialize its first business date to go live."
            : "An administrator must initialize its first business date."}
        </p>
      ) : null}
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{value}</dd>
    </div>
  );
}
