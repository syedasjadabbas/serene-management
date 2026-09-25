"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useProperty } from "@/hooks/useProperty";
import {
  useAccountQuery,
  useRemoveAccountContactMutation,
  useSetAccountContactMutation,
  useUpdateAccountMutation,
} from "@/lib/api/endpoints/accounts.api";
import { useSearchGuestsQuery } from "@/lib/api/endpoints/guests.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate, formatDateTime, formatShortDate } from "@/lib/utils/format";
import type { AccountContactView, AccountDetail } from "@/modules/accounts/accounts.types";

const KIND_LABELS = { EMPLOYEE: "Employee", CONTACT: "Contact", ASSOCIATE: "Associate" } as const;

/** Company profile: details, contacts (guest relationships), reservations and negotiated rates. */
export function CompanyDetailView({ accountId }: { accountId: string }) {
  const property = useProperty();
  const query = useAccountQuery(accountId);
  const error = toClientApiError(query.error);
  const [dialog, setDialog] = useState<null | "edit" | { contact: AccountContactView | null }>(
    null,
  );
  const [remove, removeState] = useRemoveAccountContactMutation();

  if (query.isLoading) return <StatusPanel kind="loading" title="Loading company" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={
          error?.code === "NOT_FOUND"
            ? "empty"
            : error?.code === "FORBIDDEN"
              ? "forbidden"
              : "error"
        }
        title={error?.code === "NOT_FOUND" ? "Company not found" : "Could not load the company"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          <Link
            href={`/${property.code}/guests?tab=companies` as Route}
            className="text-sm text-brand hover:underline"
          >
            Back to companies
          </Link>
        }
      />
    );
  }
  const c = query.data;
  const manage = c.actions.manage;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <Link href={`/${property.code}/guests?tab=companies` as Route} className="hover:underline">
          Companies
        </Link>{" "}
        / {c.code ?? c.name}
      </nav>
      <section className="rounded-lg border border-border-subtle bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <h1 className="text-lg font-semibold">{c.name}</h1>
          <Badge>{c.type === "TRAVEL_AGENT" ? "Travel agent" : "Company"}</Badge>
          {c.isRestricted ? <Badge tone="danger">Restricted</Badge> : null}
          {c.status !== "ACTIVE" ? <Badge>Inactive</Badge> : null}
          {manage ? (
            <Button
              size="sm"
              className="ms-auto min-h-11 md:min-h-0"
              onClick={() => setDialog("edit")}
            >
              Edit company
            </Button>
          ) : null}
        </div>
        {c.isRestricted ? (
          <div className="px-4 pt-3">
            <Alert tone="danger">
              Restricted from booking{c.restrictionReason ? `: ${c.restrictionReason}` : ""}.
            </Alert>
          </div>
        ) : null}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Code", c.code ?? "—"],
              ["Legal name", c.legalName ?? "—"],
              ["Tax id", c.taxId ?? "—"],
              ["IATA", c.iataNumber ?? "—"],
              ["E-mail", c.email ?? "—"],
              ["Phone", c.phone ?? "—"],
              [
                "Address",
                [c.addressLine1, c.addressLine2, c.city, c.region, c.postalCode, c.countryCode]
                  .filter(Boolean)
                  .join(", ") || "—",
              ],
              ["Since", formatDate(c.createdAt.slice(0, 10))],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="flex min-w-0 flex-col">
              <dt className="text-xs text-fg-muted">{term}</dt>
              <dd className="text-sm break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {c.notes ? (
          <p className="px-4 pb-4 text-sm whitespace-pre-wrap text-fg-secondary">{c.notes}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Contacts and employees</h2>
          {manage && c.contacts !== null ? (
            <Button
              size="sm"
              variant="secondary"
              className="ms-auto min-h-11 md:min-h-0"
              onClick={() => setDialog({ contact: null })}
            >
              Add relationship
            </Button>
          ) : null}
        </div>
        {c.contacts === null ? (
          <p className="text-sm text-fg-secondary">
            Contact persons need the guests:read permission.
          </p>
        ) : c.contacts.length === 0 ? (
          <p className="text-sm text-fg-secondary">No linked guests.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {c.contacts.map((contact) => (
              <li key={contact.guest.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <Link
                  href={`/${property.code}/guests/${contact.guest.id}` as Route}
                  className="font-medium text-brand hover:underline"
                >
                  {contact.guest.fullName}
                </Link>
                <Badge>{KIND_LABELS[contact.kind]}</Badge>
                {contact.isPrimary ? <Badge tone="brand">Primary contact</Badge> : null}
                {contact.role ? <span className="text-fg-muted">{contact.role}</span> : null}
                {contact.guest.email ? (
                  <span className="text-fg-muted">{contact.guest.email}</span>
                ) : null}
                {manage ? (
                  <span className="ms-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 md:min-h-0"
                      onClick={() => setDialog({ contact })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 md:min-h-0"
                      pending={
                        removeState.isLoading &&
                        removeState.originalArgs?.guestId === contact.guest.id
                      }
                      onClick={() => void remove({ accountId: c.id, guestId: contact.guest.id })}
                    >
                      Remove
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {removeState.error ? (
          <p className="text-sm text-danger">{toClientApiError(removeState.error)?.message}</p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="mb-2 font-semibold">Recent reservations</h2>
          {c.reservations.length === 0 ? (
            <p className="text-sm text-fg-secondary">No reservations at properties you can read.</p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[440px] text-sm">
                <caption className="sr-only">Reservations booked for the company</caption>
                <thead className="text-left text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Confirmation
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Guest
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Stay
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {c.reservations.map((r) => (
                    <tr key={`${r.reservationId}-${r.confirmation}`}>
                      <td className="py-1.5 pr-3">
                        {r.property.id === property.id ? (
                          <Link
                            href={`/${property.code}/reservations/${r.reservationId}` as Route}
                            className="font-mono text-brand hover:underline"
                          >
                            {r.confirmation}
                          </Link>
                        ) : (
                          <span className="font-mono">
                            {r.property.code} {r.confirmation}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{r.guestName}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {formatShortDate(r.arrival)} → {formatShortDate(r.departure)} · {r.ratePlan}
                      </td>
                      <td className="py-1.5">{r.status.toLowerCase().replace("_", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="min-w-0 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="mb-2 font-semibold">Negotiated rates</h2>
          {c.negotiatedRates.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              None. Link the company from a negotiated rate plan (Rates → plan → Companies).
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {c.negotiatedRates.map((n) => (
                <li key={`${n.property.id}-${n.ratePlan.id}`}>
                  {n.property.id === property.id ? (
                    <Link
                      href={`/${property.code}/rates/${n.ratePlan.id}` as Route}
                      className="text-brand hover:underline"
                    >
                      {n.ratePlan.code} · {n.ratePlan.name}
                    </Link>
                  ) : (
                    <span>
                      {n.property.code} · {n.ratePlan.code} · {n.ratePlan.name}
                    </span>
                  )}{" "}
                  <span className="text-fg-muted">
                    {n.validFrom || n.validTo
                      ? `${n.validFrom ? formatShortDate(n.validFrom) : "…"} → ${n.validTo ? formatShortDate(n.validTo) : "…"}`
                      : "open-ended"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {c.history ? (
        <section className="rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="mb-2 font-semibold">Audit history</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {c.history.map((h) => (
              <li key={h.id}>
                <span className="font-medium">{h.action}</span>{" "}
                <span className="text-xs text-fg-muted">
                  {formatDateTime(h.at, property.timezone)} · {h.userDisplayName ?? "system"}
                  {h.reason ? ` · ${h.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dialog === "edit" ? <EditCompanyDialog company={c} onClose={() => setDialog(null)} /> : null}
      {dialog && typeof dialog === "object" ? (
        <RelationshipDialog company={c} contact={dialog.contact} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function EditCompanyDialog({ company, onClose }: { company: AccountDetail; onClose: () => void }) {
  const [update, state] = useUpdateAccountMutation();
  const [form, setForm] = useState({
    name: company.name,
    legalName: company.legalName ?? "",
    taxId: company.taxId ?? "",
    iataNumber: company.iataNumber ?? "",
    email: company.email ?? "",
    phone: company.phone ?? "",
    addressLine1: company.addressLine1 ?? "",
    city: company.city ?? "",
    postalCode: company.postalCode ?? "",
    countryCode: company.countryCode ?? "",
    notes: company.notes ?? "",
    status: company.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    isRestricted: company.isRestricted,
    restrictionReason: company.restrictionReason ?? "",
    reason: "",
  });
  const error = toClientApiError(state.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const statusChange = form.status !== (company.status === "INACTIVE" ? "INACTIVE" : "ACTIVE");
  const restrictionChange = form.isRestricted !== company.isRestricted;
  const needsReason = statusChange || restrictionChange;
  return (
    <FormDialog
      title={`Edit ${company.name}`}
      onClose={onClose}
      onSubmit={async () => {
        const result = await update({
          accountId: company.id,
          body: {
            version: company.version,
            name: form.name,
            legalName: form.legalName,
            taxId: form.taxId,
            iataNumber: form.iataNumber,
            email: form.email,
            phone: form.phone,
            addressLine1: form.addressLine1,
            city: form.city,
            postalCode: form.postalCode,
            countryCode: form.countryCode || null,
            notes: form.notes,
            ...(statusChange ? { status: form.status as "ACTIVE" | "INACTIVE" } : {}),
            ...(restrictionChange
              ? {
                  isRestricted: form.isRestricted,
                  restrictionReason: form.isRestricted ? form.restrictionReason : null,
                }
              : {}),
            ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save company"
      disabled={
        !form.name.trim() ||
        (needsReason && form.reason.trim().length < 3) ||
        (form.isRestricted && !form.restrictionReason.trim())
      }
      pending={state.isLoading}
      error={error}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={form.name} onChange={set("name")} maxLength={200} />
        <TextField
          label="Legal name"
          value={form.legalName}
          onChange={set("legalName")}
          maxLength={200}
        />
        <TextField label="Tax id" value={form.taxId} onChange={set("taxId")} maxLength={60} />
        <TextField
          label="IATA"
          value={form.iataNumber}
          onChange={set("iataNumber")}
          maxLength={20}
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
        <TextField
          label="Address"
          value={form.addressLine1}
          onChange={set("addressLine1")}
          maxLength={200}
        />
        <TextField label="City" value={form.city} onChange={set("city")} maxLength={100} />
        <TextField
          label="Postal code"
          value={form.postalCode}
          onChange={set("postalCode")}
          maxLength={20}
        />
        <TextField
          label="Country (2 letters)"
          value={form.countryCode}
          maxLength={2}
          onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value.toUpperCase() }))}
          errors={error?.fieldErrors.countryCode}
        />
        <Select
          label="Status"
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ]}
          value={form.status}
          onChange={set("status")}
        />
      </div>
      <TextArea label="Notes" value={form.notes} onChange={set("notes")} maxLength={4000} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isRestricted}
          onChange={(e) => setForm((f) => ({ ...f, isRestricted: e.target.checked }))}
        />
        Restrict from booking (high-risk, audited)
      </label>
      {form.isRestricted ? (
        <TextField
          label="Why is it restricted?"
          value={form.restrictionReason}
          onChange={set("restrictionReason")}
          maxLength={500}
        />
      ) : null}
      <TextArea
        label={needsReason ? "Reason for the change (required)" : "Reason (optional)"}
        value={form.reason}
        onChange={set("reason")}
        maxLength={1000}
      />
    </FormDialog>
  );
}

function RelationshipDialog({
  company,
  contact,
  onClose,
}: {
  company: AccountDetail;
  contact: AccountContactView | null;
  onClose: () => void;
}) {
  const [save, state] = useSetAccountContactMutation();
  const [guest, setGuest] = useState<{ id: string; label: string } | null>(
    contact ? { id: contact.guest.id, label: contact.guest.fullName } : null,
  );
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const results = useSearchGuestsQuery(debounced, { skip: debounced.length < 2 || !!guest });
  const [kind, setKind] = useState<AccountContactView["kind"]>(contact?.kind ?? "EMPLOYEE");
  const [role, setRole] = useState(contact?.role ?? "");
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  return (
    <FormDialog
      title={contact ? `Relationship · ${contact.guest.fullName}` : "Add relationship"}
      description="One relationship per guest; making someone primary replaces the current primary contact."
      onClose={onClose}
      onSubmit={async () => {
        if (!guest) return;
        const result = await save({
          accountId: company.id,
          guestId: guest.id,
          body: { kind, role: role.trim() || null, isPrimary },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save relationship"
      disabled={!guest}
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      {guest ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Guest: <span className="font-medium">{guest.label}</span>
          {!contact ? (
            <Button size="sm" variant="ghost" onClick={() => setGuest(null)}>
              Change
            </Button>
          ) : null}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <TextField
            label="Find guest"
            placeholder="Name, e-mail, phone or profile number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div aria-live="polite" className="max-h-48 overflow-y-auto">
            {debounced.length < 2 ? (
              <p className="text-sm text-fg-muted">Type at least 2 characters.</p>
            ) : results.data && results.data.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                No guest found. Create the profile in Guests first.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
                {(results.data ?? []).map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-surface-sunken"
                      onClick={() =>
                        setGuest({ id: g.id, label: `${g.fullName} · ${g.profileNumber}` })
                      }
                    >
                      <span className="font-medium">{g.fullName}</span>
                      <span className="text-xs text-fg-muted">
                        {g.profileNumber}
                        {g.email ? ` · ${g.email}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Relationship"
          options={Object.entries(KIND_LABELS).map(([value, labelText]) => ({
            value,
            label: labelText,
          }))}
          value={kind}
          onChange={(e) => setKind(e.target.value as AccountContactView["kind"])}
        />
        <TextField
          label="Role / job title"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          maxLength={100}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />
        Primary contact of the company
      </label>
    </FormDialog>
  );
}
