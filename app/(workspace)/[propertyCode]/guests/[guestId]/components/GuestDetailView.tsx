"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Contact } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FactList } from "@/components/ui/FactList";
import { IdChip } from "@/components/ui/KeyFacts";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
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
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";

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

  if (query.isLoading) return <PageSkeleton title="Loading guest" layout="detail" />;
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
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        back={{ href: `/${property.code}/guests`, label: "Guests" }}
        icon={Contact}
        eyebrow="Guest"
        title={g.fullName}
        meta={
          <>
            {g.preferredName ? (
              <span className="text-sm text-fg-muted">“{g.preferredName}”</span>
            ) : null}
            {g.vip ? <Badge tone="brand">{g.vip.name}</Badge> : null}
            {g.isRestricted ? <Badge tone="danger">Restricted</Badge> : null}
            {g.status !== "ACTIVE" ? <Badge>Inactive</Badge> : null}
          </>
        }
        actions={
          <>
            {a.enrollLoyalty && g.status === "ACTIVE" ? (
              <Button variant="secondary" onClick={() => setDialog({ kind: "enroll" })}>
                Enroll in loyalty
              </Button>
            ) : null}
            {a.addNote ? (
              <Button variant="secondary" onClick={() => setDialog({ kind: "note" })}>
                Add note
              </Button>
            ) : null}
            {a.update ? (
              <Button variant="secondary" onClick={() => setDialog({ kind: "preferences" })}>
                Preferences
              </Button>
            ) : null}
            {a.update ? (
              <Button onClick={() => setDialog({ kind: "edit" })}>Edit profile</Button>
            ) : null}
          </>
        }
        footer={<IdChip label="Profile" value={g.profileNumber} />}
      />
      {g.alerts.length > 0 || g.isRestricted ? (
        <div className="flex flex-col gap-2">
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
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Contact">
            <FactList
              columns={3}
              items={[
                { label: "E-mail", value: g.email ?? "—" },
                { label: "Phone", value: g.phone ?? "—" },
                {
                  label: "Preferred contact",
                  value: g.preferredContact ? CONTACT_LABELS[g.preferredContact] : "—",
                },
              ]}
            />
            {g.contacts.length > 0 || g.addresses.length > 0 ? (
              <div className="mt-5 border-t border-border-subtle pt-4">
                <p className="mb-2 label-caps">Other contacts and addresses</p>
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
              </div>
            ) : null}
          </Card>
          <Card title="Identity">
            <FactList
              columns={3}
              items={[
                { label: "Nationality", value: g.nationalityCode ?? "—" },
                { label: "Language", value: g.languageCode ?? "—" },
                { label: "Gender", value: g.gender ?? "—" },
                {
                  label: "Date of birth",
                  value: a.readSensitive ? formatDate(g.dateOfBirth) || "—" : "Restricted",
                },
                { label: "Marketing", value: g.marketingOptIn ? "Opted in" : "Not opted in" },
                { label: "Profile since", value: formatDate(g.createdAt.slice(0, 10)) },
              ]}
            />
          </Card>
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
                          {formatDateTime(h.at, property.timezone)} ·{" "}
                          {h.userDisplayName ?? "system"}
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
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Stays">
            <dl className="grid grid-cols-3 gap-4 text-sm">
              {(
                [
                  ["Stays", g.statistics.stays],
                  ["Nights", g.statistics.nights],
                  ["Upcoming", g.statistics.upcoming],
                  ["Cancelled", g.statistics.cancellations],
                  ["No-shows", g.statistics.noShows],
                  [
                    "Last stay",
                    g.statistics.lastStay ? formatShortDate(g.statistics.lastStay) : "—",
                  ],
                ] as const
              ).map(([term, value]) => (
                <div key={term} className="flex flex-col">
                  <dt className="label-caps">{term}</dt>
                  <dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-fg-muted">
              Counted at the properties whose reservations you can read.
            </p>
          </Panel>
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
        </div>
      </div>

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
  return <Card title={title}>{children}</Card>;
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
  // Rows come from `currentData` so a filter change never shows the previous
  // filter's rows; the property options may keep the last known list.
  const data = query.currentData;
  const loading = query.isFetching && !data && !error;
  const rows = data?.items ?? [];
  const properties = (data ?? query.data)?.meta.properties ?? [];
  const filtered = propertyId !== "" || status !== "";
  const clearFilters = () => {
    setPropertyId("");
    setStatus("");
    setCursors([undefined]);
  };
  return (
    <Card
      title="Reservations and stays"
      actions={
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Property"
            placeholder="All"
            options={properties.map((p) => ({ value: p.id, label: p.code }))}
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setCursors([undefined]);
            }}
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
      }
    >
      {error ? (
        <StatusPanel
          kind="error"
          title="Could not load reservations"
          description={error.message}
          requestId={error.requestId}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {loading ? <StatusPanel kind="loading" title="Loading reservations" /> : null}
      {data && rows.length === 0 ? (
        filtered ? (
          <StatusPanel
            kind="empty"
            title="No reservations match these filters"
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <StatusPanel
            kind="empty"
            title="No reservations yet"
            description="Reservations and stays of this guest appear here."
          />
        )
      ) : null}
      {rows.length > 0 ? (
        <div className="relative overflow-x-auto" aria-busy={query.isFetching}>
          <Table caption="Reservations of the guest" minWidth="720px">
            <THead>
              <tr>
                <Th>Confirmation</Th>
                <Th>Property</Th>
                <Th>Stay</Th>
                <Th>Room / rate</Th>
                <Th>Company</Th>
                <Th>Status</Th>
                <Th numeric>Room total</Th>
                <Th numeric>Balance</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const own = r.property.id === property.id;
                return (
                  <Tr interactive key={r.reservationRoomId}>
                    <Td>
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
                    </Td>
                    <Td>{r.property.code}</Td>
                    <Td className="whitespace-nowrap">
                      {formatShortDate(r.arrival)} → {formatShortDate(r.departure)} · {r.nights}n
                    </Td>
                    <Td>
                      {r.roomType}
                      {r.room ? ` ${r.room}` : ""} / {r.ratePlan}
                    </Td>
                    <Td>{r.company ?? r.group ?? "—"}</Td>
                    <Td className="whitespace-nowrap">
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase().replaceAll("_", " ")}
                      {r.stay && own ? (
                        <Link
                          href={`/${property.code}/front-desk/stays/${r.stay.id}` as Route}
                          className="ms-1 text-xs text-brand hover:underline"
                        >
                          stay
                        </Link>
                      ) : null}
                    </Td>
                    <Td numeric>
                      {r.roomTotal !== null ? formatCurrency(r.roomTotal, r.currencyCode) : "—"}
                    </Td>
                    <Td numeric>
                      {r.balance !== null ? formatCurrency(r.balance, r.currencyCode) : "—"}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      ) : null}
      {cursors.length > 1 || data?.meta.nextCursor ? (
        <div className="mt-2 flex justify-between gap-2">
          <Button
            variant="secondary"
            disabled={cursors.length <= 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Newer
          </Button>
          <Button
            variant="secondary"
            disabled={!data?.meta.nextCursor}
            onClick={() => {
              const next = data?.meta.nextCursor;
              if (next) setCursors((c) => [...c, next]);
            }}
          >
            Older
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
