"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { useOrganizationAuditLogsQuery } from "@/lib/api/endpoints/organization.api";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";
import type { OrganizationAuditLogQuery } from "@/modules/audit/audit.schema";

type Filters = {
  scope: string;
  risk: string;
  resourceType: string;
  from: string;
  to: string;
};

const EMPTY: Filters = { scope: "", risk: "", resourceType: "", from: "", to: "" };

function summarize(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "meta")
    .map(([key, v]) => `${key}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

/**
 * The organization audit trail: rows from every property where the user may
 * audit, plus organization-level rows (users, guests, companies, loyalty,
 * properties) for organization auditors. The server enforces the scope.
 */
export function OrganizationAuditTrail() {
  const { data: me } = useMeQuery();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const query: Partial<OrganizationAuditLogQuery> = {
    limit: 50,
    ...(cursor ? { cursor } : {}),
    ...(filters.scope ? { scope: filters.scope } : {}),
    ...(filters.risk ? { risk: filters.risk as OrganizationAuditLogQuery["risk"] } : {}),
    ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  };
  const logs = useOrganizationAuditLogsQuery(query);
  const error = toClientApiError(logs.error);
  const timezones = new Map((me?.properties ?? []).map((p) => [p.id, p.timezone]));
  const auditable = (me?.properties ?? []).filter(
    (p) => me?.user.isSuperAdmin || p.permissions.includes("audit:read"),
  );
  const organizationAudit =
    !!me && (me.user.isSuperAdmin || me.organizationPermissions.includes("audit:read"));

  const set = (key: keyof Filters) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <header>
        <h1 className="text-xl font-semibold">Audit trail</h1>
        <p className="text-sm text-fg-secondary">
          Newest first. Times are shown in each property&apos;s time zone; organization-level
          records in UTC.
        </p>
      </header>
      <form
        className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border-subtle bg-surface p-3 md:flex md:flex-wrap"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(draft);
          setCursors([undefined]);
        }}
      >
        <Select
          label="Where"
          value={draft.scope}
          onChange={set("scope")}
          options={[
            { value: "", label: "Everything I may audit" },
            ...(organizationAudit ? [{ value: "organization", label: "Organization level" }] : []),
            ...auditable.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
          ]}
        />
        <Select
          label="Risk"
          value={draft.risk}
          onChange={set("risk")}
          options={[
            { value: "", label: "Any" },
            { value: "HIGH", label: "High" },
            { value: "STANDARD", label: "Standard" },
            { value: "LOW", label: "Low" },
          ]}
        />
        <TextField
          label="Resource type"
          value={draft.resourceType}
          onChange={set("resourceType")}
          placeholder="e.g. Reservation"
          maxLength={60}
        />
        <TextField label="From (UTC)" type="date" value={draft.from} onChange={set("from")} />
        <TextField label="To (UTC)" type="date" value={draft.to} onChange={set("to")} />
        <Button type="submit" size="touch" className="col-span-2 md:h-control md:text-sm">
          Apply
        </Button>
      </form>

      {logs.isLoading ? (
        <StatusPanel kind="loading" title="Loading the audit trail" />
      ) : error ? (
        <StatusPanel
          kind={error.status === 403 ? "forbidden" : "error"}
          title={error.status === 403 ? "Access denied" : "Could not load the audit trail"}
          description={Object.values(error.fieldErrors).flat()[0] ?? error.message}
          requestId={error.requestId}
        />
      ) : logs.data && logs.data.items.length === 0 ? (
        <StatusPanel kind="empty" title="No audit records match" />
      ) : logs.data ? (
        <section className="rounded-lg border border-border-subtle bg-surface">
          <ol className="flex flex-col divide-y divide-border-subtle text-sm">
            {logs.data.items.map((row) => (
              <li key={row.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.property ? "neutral" : "brand"}>
                    {row.property ? row.property.code : "Organization"}
                  </Badge>
                  <span className="font-medium">{row.action}</span>
                  {row.risk === "HIGH" ? <Badge tone="warning">High risk</Badge> : null}
                  <span className="text-xs text-fg-muted">
                    {formatDateTime(
                      row.createdAt,
                      (row.property && timezones.get(row.property.id)) || "UTC",
                    )}
                    {row.property ? "" : " UTC"}
                    {row.userDisplayName ? ` · ${row.userDisplayName}` : ""}
                    {row.businessDate ? ` · business date ${row.businessDate}` : ""}
                  </span>
                </div>
                <p className="text-xs text-fg-secondary">
                  {row.resourceType}
                  {row.resourceId ? ` · ${row.resourceId}` : ""}
                </p>
                {row.reason ? (
                  <p className="text-xs text-fg-secondary">Reason: {row.reason}</p>
                ) : null}
                {row.after ? (
                  <p className="font-mono text-2xs break-all text-fg-muted">
                    {summarize(row.after)}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-2.5">
            {cursors.length > 1 ? (
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11 md:min-h-0"
                onClick={() => setCursors(cursors.slice(0, -1))}
              >
                Newer
              </Button>
            ) : null}
            {logs.data.meta.nextCursor ? (
              <Button
                size="sm"
                variant="secondary"
                className="ms-auto min-h-11 md:min-h-0"
                onClick={() => setCursors([...cursors, logs.data!.meta.nextCursor!])}
                pending={logs.isFetching}
              >
                Older
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
