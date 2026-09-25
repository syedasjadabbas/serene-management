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
import { TextField } from "@/components/ui/TextField";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useCreateGuestMutation, useGuestListQuery } from "@/lib/api/endpoints/guests.api";
import { toClientApiError } from "@/lib/api/errors";
import type { PossibleDuplicate } from "@/modules/guests/guests.types";

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
  const restart = () => setCursors([undefined]);

  return (
    <section className="flex flex-col gap-3" aria-label="Guest profiles">
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Search"
          placeholder="Name, e-mail, phone, profile or confirmation number"
          value={q}
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
        {can("guests:create") ? (
          <Button size="touch" onClick={() => setCreating(true)}>
            New guest
          </Button>
        ) : null}
      </div>
      {q.trim().length === 1 ? (
        <p className="text-xs text-fg-muted">Type at least 2 characters to search.</p>
      ) : null}
      {query.isLoading ? <StatusPanel kind="loading" title="Loading guests" /> : null}
      {error ? (
        <StatusPanel
          kind="error"
          title="Could not load guests"
          description={error.message}
          requestId={error.requestId}
        />
      ) : null}
      {query.data && query.data.items.length === 0 ? (
        <StatusPanel
          kind="empty"
          title={term.length >= 2 ? "No guest matches" : "No guest profiles"}
          description={term.length >= 2 ? "Try another name, e-mail or phone." : undefined}
        />
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <ul
          className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface"
          aria-busy={query.isFetching}
        >
          {query.data.items.map((guest) => (
            <li key={guest.id}>
              <Link
                href={`/${property.code}/guests/${guest.id}` as Route}
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-surface-sunken md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{guest.fullName}</span>
                  <span className="text-xs text-fg-muted">
                    {guest.profileNumber}
                    {guest.nationalityCode ? ` · ${guest.nationalityCode}` : ""}
                  </span>
                </span>
                <span className="col-span-2 min-w-0 truncate text-sm text-fg-secondary md:col-span-1">
                  {[guest.email, guest.phone].filter(Boolean).join(" · ") || "—"}
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
      {cursors.length > 1 || query.data?.meta.nextCursor ? (
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
            disabled={!query.data?.meta.nextCursor}
            onClick={() => setCursors((c) => [...c, query.data!.meta.nextCursor!])}
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

function NewGuestDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const property = useProperty();
  const [create, state] = useCreateGuestMutation();
  const [form, setForm] = useState({
    title: "",
    firstName: "",
    lastName: "",
    preferredName: "",
    email: "",
    phone: "",
    nationalityCode: "",
  });
  const error = toClientApiError(state.error);
  const duplicates =
    error?.details.reason === "POSSIBLE_DUPLICATE"
      ? ((error.details.matches as PossibleDuplicate[] | undefined) ?? [])
      : [];
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(allowDuplicate: boolean) {
    const result = await create({ ...form, allowDuplicate });
    if ("data" in result && result.data) {
      onClose();
      onCreated(result.data.id);
    }
  }

  return (
    <FormDialog
      title="New guest profile"
      description="Shared by every property of the organization."
      onClose={onClose}
      onSubmit={() => void submit(duplicates.length > 0)}
      submitLabel={duplicates.length > 0 ? "Create anyway" : "Create guest"}
      disabled={!form.firstName.trim() || !form.lastName.trim()}
      pending={state.isLoading}
      error={duplicates.length > 0 ? null : error}
      size="lg"
    >
      {duplicates.length > 0 ? (
        <div
          className="rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm"
          role="alert"
        >
          <p className="font-medium">A profile with this e-mail or phone already exists:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/${property.code}/guests/${d.id}` as Route}
                  className="text-brand hover:underline"
                >
                  {d.fullName} · {d.profileNumber}
                </Link>{" "}
                <span className="text-fg-muted">
                  {[d.email, d.phone].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-fg-secondary">
            Open the existing profile, or create a new one anyway.
          </p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
        <TextField label="Title" value={form.title} onChange={set("title")} maxLength={20} />
        <TextField
          label="First name"
          value={form.firstName}
          onChange={set("firstName")}
          maxLength={100}
          errors={error?.fieldErrors.firstName}
        />
        <TextField
          label="Last name"
          value={form.lastName}
          onChange={set("lastName")}
          maxLength={100}
          errors={error?.fieldErrors.lastName}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Preferred name (optional)"
          value={form.preferredName}
          onChange={set("preferredName")}
          maxLength={100}
        />
        <TextField
          label="Nationality (2 letters)"
          value={form.nationalityCode}
          onChange={(e) =>
            setForm((f) => ({ ...f, nationalityCode: e.target.value.toUpperCase() }))
          }
          maxLength={2}
          errors={error?.fieldErrors.nationalityCode}
        />
        <TextField
          label="E-mail"
          type="email"
          value={form.email}
          onChange={set("email")}
          errors={error?.fieldErrors.email}
        />
        <TextField
          label="Phone"
          inputMode="tel"
          value={form.phone}
          onChange={set("phone")}
          errors={error?.fieldErrors.phone}
        />
      </div>
    </FormDialog>
  );
}
