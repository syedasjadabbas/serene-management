"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Alert } from "@/global/components/ui/Alert";
import { Badge } from "@/global/components/ui/Badge";
import { Building2 } from "lucide-react";
import { Button } from "@/global/components/ui/Button";
import { PageHeader } from "@/global/components/ui/PageHeader";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useAccountQuery,
  useRemoveAccountContactMutation,
} from "@/global/api/endpoints/accountsApi";
import { toClientApiError } from "@/global/api/errors";
import { formatDate, formatDateTime, formatShortDate } from "@serene/shared/lib/utils/format";
import type { AccountContactView } from "@serene/shared/modules/accounts/accounts.types";
import { Table, TBody, Td, Th, THead, Tr } from "@/global/components/ui/Table";
import { EditCompanyDialog, RelationshipDialog } from "./CompanyDialogs";

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

  if (query.isLoading) return <PageSkeleton title="Loading company" layout="detail" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={error?.code === "NOT_FOUND" ? "empty" : error?.status === 403 ? "forbidden" : "error"}
        title={
          error?.code === "NOT_FOUND"
            ? "Company not found"
            : error?.status === 403
              ? "Access denied"
              : "Could not load the company"
        }
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
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        back={{ href: `/${property.code}/guests?tab=companies`, label: "Companies" }}
        icon={Building2}
        eyebrow="Company"
        title={c.name}
        meta={
          <>
            <Badge>{c.type === "TRAVEL_AGENT" ? "Travel agent" : "Company"}</Badge>
            {c.isRestricted ? <Badge tone="danger">Restricted</Badge> : null}
            {c.status !== "ACTIVE" ? <Badge>Inactive</Badge> : null}
          </>
        }
        actions={
          manage ? <Button onClick={() => setDialog("edit")}>Edit company</Button> : undefined
        }
      />
      {c.isRestricted ? (
        <Alert tone="danger">
          Restricted from booking{c.restrictionReason ? `: ${c.restrictionReason}` : ""}.
        </Alert>
      ) : null}
      <section className="rounded-lg border border-border-subtle bg-surface shadow-card">
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

      <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Contacts and employees</h2>
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
        <section className="min-w-0 rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-3 text-lg font-semibold tracking-[-0.01em]">Recent reservations</h2>
          {c.reservations.length === 0 ? (
            <p className="text-sm text-fg-secondary">No reservations at properties you can read.</p>
          ) : (
            <div className="relative overflow-x-auto">
              <Table caption="Reservations booked for the company" minWidth="440px">
                <THead>
                  <tr>
                    <Th>Confirmation</Th>
                    <Th>Guest</Th>
                    <Th>Stay</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <TBody>
                  {c.reservations.map((r) => (
                    <Tr interactive key={`${r.reservationId}-${r.confirmation}`}>
                      <Td>
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
                      </Td>
                      <Td>{r.guestName}</Td>
                      <Td className="whitespace-nowrap">
                        {formatShortDate(r.arrival)} → {formatShortDate(r.departure)} · {r.ratePlan}
                      </Td>
                      <Td>{r.status.toLowerCase().replace("_", " ")}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </section>
        <section className="min-w-0 rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-3 text-lg font-semibold tracking-[-0.01em]">Negotiated rates</h2>
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
        <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-3 text-lg font-semibold tracking-[-0.01em]">Audit history</h2>
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
