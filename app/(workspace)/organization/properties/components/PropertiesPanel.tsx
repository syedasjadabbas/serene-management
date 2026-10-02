"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Hotel } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import {
  useAccessiblePropertiesQuery,
  useOrganizationOverviewQuery,
} from "@/lib/api/endpoints/organization.api";
import { toClientApiError } from "@/lib/api/errors";
import type { PropertyView } from "@/modules/properties/properties.types";
import { CopySetupDialog, CreatePropertyDialog } from "./PropertyDialogs";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";

/**
 * The properties the user can access. Organization administrators create
 * properties and copy reference setup into a new one before its go-live
 * (D37); rooms, rates and history are never copied.
 */
export function PropertiesPanel() {
  const properties = useAccessiblePropertiesQuery();
  const overview = useOrganizationOverviewQuery();
  const [dialog, setDialog] = useState<
    { kind: "create" } | { kind: "copy"; target: PropertyView } | null
  >(null);
  const manage = overview.data?.access.manageProperties ?? false;
  const dates = new Map(
    (overview.data?.properties ?? []).map((p) => [p.property.id, p.businessDate]),
  );
  const error = toClientApiError(properties.error);
  // The overview only adds business dates and the manage flag; when it fails
  // the list is still shown, with dates as "—".
  const overviewFailed = !!overview.error && !overview.data;

  if (properties.isLoading || overview.isLoading)
    return <PageSkeleton title="Loading properties" />;
  if (error || !properties.data) {
    return (
      <StatusPanel
        kind={error?.status === 403 ? "forbidden" : "error"}
        title={error?.status === 403 ? "Access denied" : "Could not load properties"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          error?.status === 403 ? undefined : (
            <Button size="sm" variant="secondary" onClick={() => void properties.refetch()}>
              Retry
            </Button>
          )
        }
      />
    );
  }
  const list = properties.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Hotel}
        breadcrumbs={[{ label: "Organization", href: "/organization" }, { label: "Properties" }]}
        title="Properties"
        description="New confirmation numbers carry each property's prefix (e.g. SMR-100045)."
        actions={
          manage ? (
            <Button
              className="md:h-control md:text-sm"
              onClick={() => setDialog({ kind: "create" })}
            >
              New property
            </Button>
          ) : undefined
        }
      />
      {overviewFailed ? (
        <Alert tone="warning">
          Business dates could not be loaded, so they show as “—”.{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => void overview.refetch()}
          >
            Retry
          </button>
        </Alert>
      ) : null}
      {list.length === 0 ? (
        <StatusPanel
          kind="empty"
          title="No properties yet"
          description={
            manage
              ? "Create the first property to start setting it up."
              : "You have not been given access to any property."
          }
          action={
            manage ? (
              <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
                New property
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section className="rounded-lg border border-border-subtle bg-surface shadow-card">
          <div className="relative overflow-x-auto">
            <Table caption="Properties you can access" minWidth="640px">
              <THead>
                <tr>
                  <Th>Property</Th>
                  <Th className="pe-3">Currency</Th>
                  <Th className="pe-3">Time zone</Th>
                  <Th className="pe-3">Prefix</Th>
                  <Th className="pe-3">Business date</Th>
                  <Th className="pe-4">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {list.map((p) => {
                  const businessDate = dates.get(p.id) ?? null;
                  return (
                    <Tr interactive key={p.id}>
                      <Th scope="row">
                        <span className="me-2 font-mono text-xs text-fg-muted">{p.code}</span>
                        {p.name}
                      </Th>
                      <Td className="pe-3">{p.currencyCode}</Td>
                      <Td className="pe-3 text-fg-secondary">{p.timezone}</Td>
                      <Td className="pe-3 font-mono text-xs">{p.confirmationPrefix}</Td>
                      <Td className="pe-3">
                        {overviewFailed ? (
                          <span className="text-fg-muted">—</span>
                        ) : businessDate ? (
                          <span className="font-mono text-xs">{businessDate}</span>
                        ) : (
                          <Badge tone="warning">Not live</Badge>
                        )}
                      </Td>
                      <Td className="pe-4">
                        <span className="flex justify-end gap-1.5">
                          {manage && !businessDate && list.length > 1 ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="min-h-11 md:min-h-0"
                              onClick={() => setDialog({ kind: "copy", target: p })}
                            >
                              Copy setup
                            </Button>
                          ) : null}
                          <Link
                            href={`/${p.code}` as Route}
                            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-brand hover:underline md:min-h-0"
                          >
                            Open
                          </Link>
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </section>
      )}
      {dialog?.kind === "create" ? <CreatePropertyDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "copy" ? (
        <CopySetupDialog
          target={dialog.target}
          sources={list.filter((p) => p.id !== dialog.target.id)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
