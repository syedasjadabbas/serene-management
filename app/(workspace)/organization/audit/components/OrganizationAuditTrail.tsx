"use client";

import { useState } from "react";
import { ScrollText } from "lucide-react";
import { auditActionLabel, auditChanges, auditFieldLabel } from "@/components/audit/audit-format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
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

/**
 * Record types the application writes to the audit trail (the server
 * matches the type exactly, so the filter offers the real names).
 */
const RESOURCE_TYPES: { value: string; label: string; group: string }[] = [
  ["Reservation", "Reservation", "Front office"],
  ["ReservationRoom", "Reservation room", "Front office"],
  ["Stay", "Stay", "Front office"],
  ["Guest", "Guest", "Profiles"],
  ["AccountProfile", "Company / agent", "Profiles"],
  ["Group", "Group", "Profiles"],
  ["Block", "Group block", "Profiles"],
  ["LoyaltyProgram", "Loyalty program", "Profiles"],
  ["LoyaltyMembership", "Loyalty membership", "Profiles"],
  ["Room", "Room", "Rooms"],
  ["HousekeepingTask", "Housekeeping task", "Rooms"],
  ["MaintenanceRequest", "Maintenance request", "Rooms"],
  ["RatePlan", "Rate plan", "Revenue"],
  ["Package", "Package", "Revenue"],
  ["Restriction", "Restriction", "Revenue"],
  ["Folio", "Folio", "Finance"],
  ["NightAuditRun", "Night audit run", "Finance"],
  ["BusinessDate", "Business date", "Finance"],
  ["User", "User", "Administration"],
  ["UserRoleAssignment", "Role assignment", "Administration"],
  ["AuthSession", "Sign-in session", "Administration"],
  ["Property", "Property", "Administration"],
  ["PropertyConfiguration", "Property settings", "Administration"],
  ["Organization", "Organization", "Administration"],
].map(([value, label, group]) => ({ value: value!, label: label!, group: group! }));
const RESOURCE_LABELS = new Map(RESOURCE_TYPES.map((t) => [t.value, t.label]));

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
  // Rows of the current filters and page only: never the previous result.
  const rows = logs.currentData;
  const error = toClientApiError(logs.error);
  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to);
  const filtered = Object.values(filters).some(Boolean);
  const dirty = Object.values(draft).some(Boolean) || filtered;
  const reset = () => {
    setDraft(EMPTY);
    setFilters(EMPTY);
    setCursors([undefined]);
  };
  const timezones = new Map((me?.properties ?? []).map((p) => [p.id, p.timezone]));
  const auditable = (me?.properties ?? []).filter(
    (p) => me?.user.isSuperAdmin || p.permissions.includes("audit:read"),
  );
  const organizationAudit =
    !!me && (me.user.isSuperAdmin || me.organizationPermissions.includes("audit:read"));

  const set = (key: keyof Filters) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ScrollText}
        breadcrumbs={[{ label: "Organization", href: "/organization" }, { label: "Audit" }]}
        title="Audit trail"
        description="Newest first. Times are shown in each property's time zone; organization-level records in UTC."
      />
      <form
        className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border-subtle bg-surface p-3 shadow-card md:flex md:flex-wrap"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalidRange) return;
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
        <Select
          label="Resource type"
          placeholder="Any type"
          value={draft.resourceType}
          onChange={set("resourceType")}
          options={RESOURCE_TYPES}
        />
        <TextField
          label="From (UTC)"
          type="date"
          value={draft.from}
          max={draft.to || undefined}
          onChange={set("from")}
        />
        <TextField
          label="To (UTC)"
          type="date"
          value={draft.to}
          min={draft.from || undefined}
          onChange={set("to")}
          errors={invalidRange ? ["To must be on or after From"] : undefined}
        />
        <div className="col-span-2 flex gap-2 md:col-span-1">
          <Button type="submit" disabled={invalidRange} className="flex-1 md:flex-none">
            Apply
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={reset}>
              Reset
            </Button>
          ) : null}
        </div>
      </form>

      {logs.isLoading || (logs.isFetching && !rows) ? (
        <StatusPanel kind="loading" title="Loading the audit trail" />
      ) : error ? (
        <StatusPanel
          kind={error.status === 403 ? "forbidden" : "error"}
          title={error.status === 403 ? "Access denied" : "Could not load the audit trail"}
          description={Object.values(error.fieldErrors).flat()[0] ?? error.message}
          requestId={error.requestId}
        />
      ) : rows && rows.items.length === 0 ? (
        filtered ? (
          <StatusPanel
            kind="empty"
            title="No audit records match these filters"
            description="Widen the dates or choose another place, risk or type."
            action={
              <Button variant="secondary" onClick={reset}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <StatusPanel kind="empty" title="No audit records yet" />
        )
      ) : rows ? (
        <section className="rounded-lg border border-border-subtle bg-surface shadow-card">
          <ol className="flex flex-col divide-y divide-border-subtle text-sm">
            {rows.items.map((row) => (
              <li key={row.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.property ? "neutral" : "brand"}>
                    {row.property ? row.property.code : "Organization"}
                  </Badge>
                  <span className="font-medium">{auditActionLabel(row.action)}</span>
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
                  {RESOURCE_LABELS.get(row.resourceType) ?? row.resourceType}
                </p>
                {row.reason ? (
                  <p className="text-xs text-fg-secondary">Reason: {row.reason}</p>
                ) : null}
                <AuditChanges before={row.before} after={row.after} />
                <details className="text-2xs text-fg-muted">
                  <summary className="w-fit cursor-pointer select-none hover:text-fg-secondary">
                    Audit reference
                  </summary>
                  <p className="mt-1 font-mono break-all">
                    {row.action}
                    {row.resourceId ? ` · ${row.resourceType} ${row.resourceId}` : ""}
                  </p>
                </details>
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
            {rows.meta.nextCursor ? (
              <Button
                size="sm"
                variant="secondary"
                className="ms-auto min-h-11 md:min-h-0"
                onClick={() => setCursors([...cursors, rows.meta.nextCursor!])}
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

/** The changed fields of a row, inline: "Status: Reserved → In house". */
function AuditChanges({ before, after }: { before: unknown; after: unknown }) {
  const list = auditChanges(before, after);
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-secondary">
      {list.map((c) => (
        <li key={c.key} className="min-w-0 break-words">
          <span className="text-fg-muted">{auditFieldLabel(c.key)}:</span>{" "}
          {c.before !== undefined && c.after !== undefined ? (
            <>
              <span className="text-fg-muted line-through decoration-fg-muted/50">{c.before}</span>
              <span aria-hidden="true" className="px-1 text-fg-muted">
                →
              </span>
              <span className="sr-only"> changed to </span>
              {c.after}
            </>
          ) : (
            (c.after ?? c.before)
          )}
        </li>
      ))}
    </ul>
  );
}
