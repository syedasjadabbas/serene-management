"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useProperty } from "@/hooks/useProperty";
import {
  useDeleteGuestNoteMutation,
  useGuestHistoryQuery,
  useGuestQuery,
} from "@/lib/api/endpoints/guests.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, formatDateTime, formatShortDate } from "@/lib/utils/format";
import type { GuestProfileView, LoyaltyMembershipView } from "@/modules/guests/guests.types";
import {
  EditProfileDialog,
  EnrollDialog,
  MembershipDialog,
  NoteDialog,
  PointsDialog,
  PreferencesDialog,
} from "./GuestDialogs";

type Dialog =
  | null
  | { kind: "edit" | "preferences" | "note" | "enroll" }
  | { kind: "membership" | "points"; membership: LoyaltyMembershipView };

const CONTACT_LABELS: Record<string, string> = {
  EMAIL: "E-mail",
  PHONE: "Phone",
  MOBILE: "Mobile",
  WHATSAPP: "WhatsApp",
  FAX: "Fax",
};

/** One guest profile: identity, contacts, preferences, notes, companies, loyalty and history. */
export function GuestDetailView({ guestId }: { guestId: string }) {
  const property = useProperty();
  const query = useGuestQuery(guestId);
  const error = toClientApiError(query.error);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  if (query.isLoading) return <StatusPanel kind="loading" title="Loading guest" />;
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
        title={error?.code === "NOT_FOUND" ? "Guest not found" : "Could not load the guest"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          <Link
            href={`/${property.code}/guests` as Route}
            className="text-sm text-brand hover:underline"
          >
            Back to guests
          </Link>
        }
      />
    );
  }
  const g = query.data;
  const a = g.access;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
        <Link href={`/${property.code}/guests` as Route} className="hover:underline">
          Guests
        </Link>{" "}
        / {g.profileNumber}
      </nav>
      <section className="rounded-lg border border-border-subtle bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <h1 className="text-lg font-semibold">{g.fullName}</h1>
          {g.preferredName ? (
            <span className="text-sm text-fg-muted">“{g.preferredName}”</span>
          ) : null}
          {g.vip ? <Badge tone="brand">{g.vip.name}</Badge> : null}
          {g.isRestricted ? <Badge tone="danger">Restricted</Badge> : null}
          {g.status !== "ACTIVE" ? <Badge>Inactive</Badge> : null}
          <span className="ms-auto flex flex-wrap gap-1.5">
            {a.update ? (
              <Button
                size="sm"
                className="min-h-11 md:min-h-0"
                onClick={() => setDialog({ kind: "edit" })}
              >
                Edit profile
              </Button>
            ) : null}
            {a.update ? (
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11 md:min-h-0"
                onClick={() => setDialog({ kind: "preferences" })}
              >
                Preferences
              </Button>
            ) : null}
            {a.addNote ? (
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11 md:min-h-0"
                onClick={() => setDialog({ kind: "note" })}
              >
                Add note
              </Button>
            ) : null}
            {a.manageLoyalty && g.status === "ACTIVE" ? (
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11 md:min-h-0"
                onClick={() => setDialog({ kind: "enroll" })}
              >
                Enroll in loyalty
              </Button>
            ) : null}
          </span>
        </div>
        {g.alerts.length > 0 || g.isRestricted ? (
          <div className="flex flex-col gap-2 px-4 pt-3">
            {g.isRestricted ? (
              <Alert tone="danger">
                Restricted from booking{g.restrictionReason ? `: ${g.restrictionReason}` : ""}.
              </Alert>
            ) : null}
            {g.alerts.map((alert, i) => (
              <Alert key={i} tone="warning">
                {alert}
              </Alert>
            ))}
          </div>
        ) : null}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Profile", g.profileNumber],
              ["E-mail", g.email ?? "—"],
              ["Phone", g.phone ?? "—"],
              ["Preferred contact", g.preferredContact ? CONTACT_LABELS[g.preferredContact] : "—"],
              ["Nationality", g.nationalityCode ?? "—"],
              ["Language", g.languageCode ?? "—"],
              ["Gender", g.gender ?? "—"],
              ["Date of birth", a.readSensitive ? formatDate(g.dateOfBirth) || "—" : "Restricted"],
              ["Marketing", g.marketingOptIn ? "Opted in" : "Not opted in"],
              ["Profile since", formatDate(g.createdAt.slice(0, 10))],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="flex min-w-0 flex-col">
              <dt className="text-xs text-fg-muted">{term}</dt>
              <dd className="truncate text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Contacts and addresses">
          {g.contacts.length === 0 && g.addresses.length === 0 ? (
            <p className="text-sm text-fg-secondary">Only the primary e-mail and phone.</p>
          ) : null}
          <ul className="flex flex-col gap-1 text-sm">
            {g.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-2">
                <span className="w-20 text-xs text-fg-muted">{CONTACT_LABELS[c.type]}</span>
                <span className="min-w-0 break-all">{c.value}</span>
                {c.isPrimary ? <Badge>Primary</Badge> : null}
              </li>
            ))}
            {g.addresses.map((ad) => (
              <li key={ad.id} className="flex flex-wrap gap-2">
                <span className="w-20 text-xs text-fg-muted">{ad.type.toLowerCase()}</span>
                <span className="min-w-0">
                  {[ad.line1, ad.line2, ad.city, ad.region, ad.postalCode, ad.countryCode]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {ad.isPrimary ? <Badge>Primary</Badge> : null}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Stays">
          <dl className="grid grid-cols-3 gap-2 text-sm">
            {(
              [
                ["Stays", g.statistics.stays],
                ["Nights", g.statistics.nights],
                ["Upcoming", g.statistics.upcoming],
                ["Cancelled", g.statistics.cancellations],
                ["No-shows", g.statistics.noShows],
                ["Last stay", g.statistics.lastStay ? formatShortDate(g.statistics.lastStay) : "—"],
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="flex flex-col">
                <dt className="text-xs text-fg-muted">{term}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-fg-muted">
            Counted at the properties whose reservations you can read.
          </p>
        </Panel>
        <Panel title="Preferences">
          {g.preferences.length === 0 ? (
            <p className="text-sm text-fg-secondary">No preferences recorded.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {g.preferences.map((p) => (
                <li key={p.id}>
                  <Badge tone="info">
                    {p.preferenceCode.name}
                    {p.property ? ` · ${p.property.code}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Notes">
          <NotesList guest={g} />
        </Panel>
        {g.companies !== null ? (
          <Panel title="Companies">
            {g.companies.length === 0 ? (
              <p className="text-sm text-fg-secondary">Not linked to a company.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {g.companies.map((c) => (
                  <li key={c.account.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/${property.code}/companies/${c.account.id}` as Route}
                      className="text-brand hover:underline"
                    >
                      {c.account.name}
                    </Link>
                    <Badge>{c.kind.toLowerCase()}</Badge>
                    {c.isPrimary ? <Badge tone="brand">Primary contact</Badge> : null}
                    {c.role ? <span className="text-fg-muted">{c.role}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {a.manageCompanies ? (
              <p className="mt-2 text-xs text-fg-muted">
                Manage relationships from the company page.
              </p>
            ) : null}
          </Panel>
        ) : null}
        {g.loyalty !== null ? (
          <Panel title="Loyalty">
            {g.loyalty.length === 0 ? (
              <p className="text-sm text-fg-secondary">Not a member.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {g.loyalty.map((m) => (
                  <li key={m.id} className="flex flex-col gap-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.program.name}</span>
                      <span className="font-mono text-xs">{m.membershipNumber}</span>
                      {m.tier ? <Badge tone="brand">{m.tier.name}</Badge> : null}
                      <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>
                        {m.status.toLowerCase()}
                      </Badge>
                      <span className="tabular-nums">{m.pointsBalance} pts</span>
                      {a.manageLoyalty ? (
                        <span className="ms-auto flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-11 md:min-h-0"
                            onClick={() => setDialog({ kind: "membership", membership: m })}
                          >
                            Tier / status
                          </Button>
                          {m.status === "ACTIVE" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="min-h-11 md:min-h-0"
                              onClick={() => setDialog({ kind: "points", membership: m })}
                            >
                              Adjust points
                            </Button>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                    <details className="text-xs text-fg-secondary">
                      <summary className="cursor-pointer py-1">History and points</summary>
                      <ul className="flex flex-col gap-0.5 ps-3">
                        {m.changes.map((c) => (
                          <li key={c.id}>
                            {formatDateTime(c.at, property.timezone)} ·{" "}
                            {c.type === "ENROLLED"
                              ? `Enrolled${c.toTier ? ` at ${c.toTier}` : ""}`
                              : c.type === "TIER_CHANGED"
                                ? `Tier ${c.fromTier ?? "none"} → ${c.toTier ?? "none"}`
                                : `Status ${c.fromStatus?.toLowerCase()} → ${c.toStatus?.toLowerCase()}`}
                            {c.reason ? ` (${c.reason})` : ""}
                            {c.by ? ` · ${c.by}` : ""}
                          </li>
                        ))}
                        {m.transactions.map((t) => (
                          <li key={t.id}>
                            {formatDateTime(t.at, property.timezone)} · {t.type.toLowerCase()}{" "}
                            <span className="tabular-nums">{t.points}</span>
                            {t.description ? ` · ${t.description}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>

      {a.readHistory ? <HistoryPanel guestId={g.id} /> : null}

      {g.history ? (
        <Panel title="Audit history">
          {g.history.length === 0 ? (
            <p className="text-sm text-fg-secondary">No changes recorded.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {g.history.map((h) => (
                <li key={h.id} className="flex flex-col">
                  <span>
                    <span className="font-medium">{h.action}</span>
                    {h.risk === "HIGH" ? (
                      <Badge tone="warning" className="ms-1">
                        High
                      </Badge>
                    ) : null}{" "}
                    <span className="text-xs text-fg-muted">
                      {formatDateTime(h.at, property.timezone)} · {h.userDisplayName ?? "system"}
                    </span>
                  </span>
                  {h.reason ? (
                    <span className="text-xs text-fg-secondary">Reason: {h.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {dialog?.kind === "edit" ? <EditProfileDialog guest={g} onClose={close} /> : null}
      {dialog?.kind === "preferences" ? <PreferencesDialog guest={g} onClose={close} /> : null}
      {dialog?.kind === "note" ? <NoteDialog guest={g} onClose={close} /> : null}
      {dialog?.kind === "enroll" ? <EnrollDialog guest={g} onClose={close} /> : null}
      {dialog?.kind === "membership" ? (
        <MembershipDialog guest={g} membership={dialog.membership} onClose={close} />
      ) : null}
      {dialog?.kind === "points" ? (
        <PointsDialog guest={g} membership={dialog.membership} onClose={close} />
      ) : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border-subtle bg-surface p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function NotesList({ guest }: { guest: GuestProfileView }) {
  const property = useProperty();
  const [remove, state] = useDeleteGuestNoteMutation();
  const error = toClientApiError(state.error);
  if (guest.notes.length === 0) return <p className="text-sm text-fg-secondary">No notes.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {guest.notes.map((n) => (
        <li key={n.id} className="flex flex-col gap-0.5">
          <span className="whitespace-pre-wrap">{n.body}</span>
          <span className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
            {n.isAlert ? <Badge tone="warning">Alert</Badge> : null}
            {n.visibility !== "ALL_STAFF" ? <Badge>{n.visibility.toLowerCase()}</Badge> : null}
            {n.property ? <Badge>{n.property.code}</Badge> : null}
            {formatDateTime(n.createdAt, property.timezone)}
            {n.createdBy ? ` · ${n.createdBy}` : ""}
            {n.canDelete ? (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 md:min-h-0"
                pending={state.isLoading && state.originalArgs?.noteId === n.id}
                onClick={() => void remove({ guestId: guest.id, noteId: n.id })}
              >
                Delete
              </Button>
            ) : null}
          </span>
        </li>
      ))}
      {error ? <li className="text-danger">{error.message}</li> : null}
    </ul>
  );
}

const STATUS_OPTIONS = [
  "RESERVED",
  "WAITLISTED",
  "IN_HOUSE",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
];

function HistoryPanel({ guestId }: { guestId: string }) {
  const property = useProperty();
  const [propertyId, setPropertyId] = useState("");
  const [status, setStatus] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = useGuestHistoryQuery({
    guestId,
    propertyId: propertyId || undefined,
    status: status || undefined,
    cursor: cursors.at(-1),
  });
  const error = toClientApiError(query.error);
  const rows = query.data?.items ?? [];
  const properties = query.data?.meta.properties ?? [];
  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-end gap-3">
        <h2 className="font-semibold">Reservations and stays</h2>
        <Select
          label="Property"
          placeholder="All"
          options={properties.map((p) => ({ value: p.id, label: p.code }))}
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setCursors([undefined]);
          }}
          className="ms-auto"
        />
        <Select
          label="Status"
          placeholder="All"
          options={STATUS_OPTIONS.map((s) => ({
            value: s,
            label: s.toLowerCase().replace("_", " "),
          }))}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursors([undefined]);
          }}
        />
      </div>
      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {query.isLoading ? <p className="text-sm text-fg-muted">Loading…</p> : null}
      {!query.isLoading && rows.length === 0 ? (
        <p className="text-sm text-fg-secondary">No reservations.</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Reservations of the guest</caption>
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Confirmation
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Property
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Stay
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Room / rate
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Company
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-3 text-end font-medium">
                  Room total
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {rows.map((r) => {
                const own = r.property.id === property.id;
                return (
                  <tr key={r.reservationRoomId}>
                    <td className="py-2 pr-3">
                      {own ? (
                        <Link
                          href={`/${property.code}/reservations/${r.reservationId}` as Route}
                          className="font-mono text-brand hover:underline"
                        >
                          {r.confirmation}
                        </Link>
                      ) : (
                        <span className="font-mono">{r.confirmation}</span>
                      )}
                      {!r.isPrimaryGuest ? (
                        <span className="ms-1 text-xs text-fg-muted">sharer</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{r.property.code}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatShortDate(r.arrival)} → {formatShortDate(r.departure)} · {r.nights}n
                    </td>
                    <td className="py-2 pr-3">
                      {r.roomType}
                      {r.room ? ` ${r.room}` : ""} / {r.ratePlan}
                    </td>
                    <td className="py-2 pr-3">{r.company ?? r.group ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {r.status.toLowerCase().replace("_", " ")}
                      {r.stay && own ? (
                        <Link
                          href={`/${property.code}/front-desk/stays/${r.stay.id}` as Route}
                          className="ms-1 text-xs text-brand hover:underline"
                        >
                          stay
                        </Link>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-end tabular-nums">
                      {r.roomTotal !== null ? formatCurrency(r.roomTotal, r.currencyCode) : "—"}
                    </td>
                    <td className="py-2 text-end tabular-nums">
                      {r.balance !== null ? formatCurrency(r.balance, r.currencyCode) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {cursors.length > 1 || query.data?.meta.nextCursor ? (
        <div className="mt-2 flex justify-between gap-2">
          <Button
            size="touch"
            variant="secondary"
            disabled={cursors.length <= 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Newer
          </Button>
          <Button
            size="touch"
            variant="secondary"
            disabled={!query.data?.meta.nextCursor}
            onClick={() => setCursors((c) => [...c, query.data!.meta.nextCursor!])}
          >
            Older
          </Button>
        </div>
      ) : null}
    </section>
  );
}
