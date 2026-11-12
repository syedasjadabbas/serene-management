"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/global/components/ui/Badge";
import { Button } from "@/global/components/ui/Button";
import { Select } from "@/global/components/ui/Select";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { TextField } from "@/global/components/ui/TextField";
import { highlight } from "@/global/components/ui/listbox";
import { useDebouncedValue } from "@/global/hooks/useDebouncedValue";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";
import { useGuestListQuery } from "@/global/api/endpoints/guestsApi";
import { toClientApiError } from "@/global/api/errors";
import { NewGuestDialog } from "./NewGuestDialog";

/** Server-side guest search with keyset pages ("Next" / "Previous"). */
export function GuestsPanel() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [creating, setCreating] = useState(false);
  const term = useDebouncedValue(q.trim(), 300);
  const cursor = cursors.at(-1);
  const query = useGuestListQuery({
    q: term.length >= 2 ? term : undefined,
    status,
    cursor,
    limit: 20,
  });
  const error = toClientApiError(query.error);
  // `currentData` belongs to the current filter only; `data` would keep the
  // previous filter's rows on screen while the new page loads.
  const data = query.currentData;
  const loading = query.isFetching && !data && !error;
  const searching = term.length >= 2;
  const filtered = searching || status !== "ACTIVE";
  const restart = () => setCursors([undefined]);
  const clearFilters = () => {
    setQ("");
    setStatus("ACTIVE");
    restart();
  };
  const emptyTitle = searching
    ? "No guest matches"
    : status === "INACTIVE"
      ? "No inactive guests"
      : "No guest profiles";

  return (
    <section className="flex flex-col gap-3" aria-label="Guest profiles">
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Search"
          placeholder="Name, e-mail, phone, profile or confirmation number"
          value={q}
          maxLength={100}
          onChange={(e) => {
            setQ(e.target.value);
            restart();
          }}
          className="min-w-0 flex-1 basis-64"
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
        {can("guests:create") ? <Button onClick={() => setCreating(true)}>New guest</Button> : null}
      </div>
      {q.trim().length === 1 ? (
        <p className="text-xs text-fg-muted">Type at least 2 characters to search.</p>
      ) : null}
      {loading ? <StatusPanel kind="loading" title="Loading guests" /> : null}
      {error ? (
        <StatusPanel
          kind="error"
          title="Could not load guests"
          description={error.message}
          requestId={error.requestId}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {data && data.items.length === 0 ? (
        <StatusPanel
          kind="empty"
          title={emptyTitle}
          description={searching ? "Try another name, e-mail or phone." : undefined}
          action={
            filtered ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {data && data.items.length > 0 ? (
        <ul
          className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-card"
          aria-busy={query.isFetching}
        >
          {data.items.map((guest) => (
            <li key={guest.id}>
              <Link
                href={`/${property.code}/guests/${guest.id}` as Route}
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-surface-sunken md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_9rem]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {searching ? highlight(guest.fullName, term) : guest.fullName}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {searching ? highlight(guest.profileNumber, term) : guest.profileNumber}
                    {guest.nationalityCode ? ` · ${guest.nationalityCode}` : ""}
                  </span>
                </span>
                <span className="col-span-2 min-w-0 truncate text-sm text-fg-secondary md:col-span-1">
                  {(() => {
                    const contact = [guest.email, guest.phone].filter(Boolean).join(" · ");
                    if (!contact) return "—";
                    return searching ? highlight(contact, term) : contact;
                  })()}
                </span>
                <span className="col-span-2 flex gap-1 md:col-span-1 md:justify-self-end">
                  {guest.vip ? <Badge tone="brand">{guest.vip.code}</Badge> : null}
                  {guest.isRestricted ? <Badge tone="danger">Restricted</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {cursors.length > 1 || data?.meta.nextCursor ? (
        <div className="flex justify-between gap-2">
          <Button
            variant="secondary"
            disabled={cursors.length <= 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
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
        <NewGuestDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/${property.code}/guests/${id}` as Route)}
        />
      ) : null}
    </section>
  );
}
