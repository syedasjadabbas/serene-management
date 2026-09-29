"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useAccountsQuery, useCreateAccountMutation } from "@/lib/api/endpoints/accounts.api";
import { toClientApiError } from "@/lib/api/errors";

const TYPE_LABELS: Record<string, string> = { COMPANY: "Company", TRAVEL_AGENT: "Travel agent" };

/** Company and travel-agent profiles (organization data). */
export function CompaniesPanel() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [creating, setCreating] = useState(false);
  const term = useDebouncedValue(q.trim(), 300);
  const query = useAccountsQuery({
    q: term.length >= 2 ? term : undefined,
    type: type || undefined,
    status,
    cursor: cursors.at(-1),
  });
  const error = toClientApiError(query.error);
  // `currentData` belongs to the current filter only; `data` would keep the
  // previous filter's rows on screen while the new page loads.
  const data = query.currentData;
  const loading = query.isFetching && !data && !error;
  const filtered = term.length >= 2 || type !== "" || status !== "ACTIVE";
  const restart = () => setCursors([undefined]);
  const clearFilters = () => {
    setQ("");
    setType("");
    setStatus("ACTIVE");
    restart();
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Companies">
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Search"
          placeholder="Name or code"
          value={q}
          maxLength={100}
          onChange={(e) => {
            setQ(e.target.value);
            restart();
          }}
          className="min-w-0 flex-1 basis-56"
        />
        <Select
          label="Type"
          placeholder="All"
          options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            restart();
          }}
        />
        <Select
          label="Status"
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ]}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            restart();
          }}
        />
        {can("accounts:manage") ? (
          <Button size="touch" onClick={() => setCreating(true)}>
            New company
          </Button>
        ) : null}
      </div>
      {q.trim().length === 1 ? (
        <p className="text-xs text-fg-muted">Type at least 2 characters to search.</p>
      ) : null}
      {loading ? <StatusPanel kind="loading" title="Loading companies" /> : null}
      {error ? (
        <StatusPanel
          kind="error"
          title="Could not load companies"
          description={error.message}
          requestId={error.requestId}
          action={
            <Button size="touch" variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {data && data.items.length === 0 ? (
        filtered ? (
          <StatusPanel
            kind="empty"
            title="No company matches"
            description="No company or travel agent matches these filters."
            action={
              <Button size="touch" variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <StatusPanel
            kind="empty"
            title="No companies yet"
            description="Company and travel-agent profiles you add appear here."
          />
        )
      ) : null}
      {data && data.items.length > 0 ? (
        <ul
          className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface"
          aria-busy={query.isFetching}
        >
          {data.items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/${property.code}/companies/${a.id}` as Route}
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-surface-sunken md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="text-xs text-fg-muted">
                    {a.code ?? "—"} · {TYPE_LABELS[a.type] ?? a.type}
                  </span>
                </span>
                <span className="col-span-2 text-sm text-fg-secondary md:col-span-1">
                  {[a.city, a.countryCode].filter(Boolean).join(", ") || "—"} · {a.contacts} contact
                  {a.contacts === 1 ? "" : "s"}
                </span>
                <span className="col-span-2 flex gap-1 md:col-span-1 md:justify-self-end">
                  {a.isRestricted ? <Badge tone="danger">Restricted</Badge> : null}
                  {a.status !== "ACTIVE" ? <Badge>Inactive</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {cursors.length > 1 || data?.meta.nextCursor ? (
        <div className="flex justify-between gap-2">
          <Button
            size="touch"
            variant="secondary"
            disabled={cursors.length <= 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
            size="touch"
            variant="secondary"
            disabled={!data?.meta.nextCursor}
            onClick={() => {
              const next = data?.meta.nextCursor;
              if (next) setCursors((c) => [...c, next]);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
      {creating ? (
        <NewCompanyDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/${property.code}/companies/${id}` as Route)}
        />
      ) : null}
    </section>
  );
}

function NewCompanyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [create, state] = useCreateAccountMutation();
  const [form, setForm] = useState({
    type: "COMPANY",
    code: "",
    name: "",
    email: "",
    phone: "",
    city: "",
    countryCode: "",
    notes: "",
  });
  const error = toClientApiError(state.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <FormDialog
      title="New company"
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          type: form.type as "COMPANY" | "TRAVEL_AGENT",
          code: form.code.trim(),
          name: form.name.trim(),
          email: form.email || null,
          phone: form.phone || null,
          city: form.city || null,
          countryCode: form.countryCode || null,
          notes: form.notes || null,
        });
        if ("data" in result && result.data) {
          onClose();
          onCreated(result.data.id);
        }
      }}
      submitLabel="Create company"
      disabled={!form.code.trim() || !form.name.trim()}
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Type"
          options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          value={form.type}
          onChange={set("type")}
        />
        <TextField
          label="Code"
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
          maxLength={20}
          errors={error?.fieldErrors.code}
        />
        <TextField
          label="Name"
          value={form.name}
          onChange={set("name")}
          maxLength={200}
          className="sm:col-span-2"
        />
        <TextField
          label="E-mail"
          type="email"
          value={form.email}
          onChange={set("email")}
          errors={error?.fieldErrors.email}
        />
        <TextField label="Phone" inputMode="tel" value={form.phone} onChange={set("phone")} />
        <TextField label="City" value={form.city} onChange={set("city")} maxLength={100} />
        <TextField
          label="Country (2 letters)"
          value={form.countryCode}
          onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value.toUpperCase() }))}
          maxLength={2}
          errors={error?.fieldErrors.countryCode}
        />
      </div>
      <TextArea
        label="Notes (optional)"
        value={form.notes}
        onChange={set("notes")}
        maxLength={4000}
      />
    </FormDialog>
  );
}
