"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import {
  useAccessiblePropertiesQuery,
  useOrganizationOverviewQuery,
} from "@/lib/api/endpoints/organization.api";
import { toClientApiError } from "@/lib/api/errors";
import type { PropertyView } from "@/modules/properties/properties.types";
import { CopySetupDialog, CreatePropertyDialog } from "./PropertyDialogs";

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
  const error = toClientApiError(properties.error ?? overview.error);

  if (properties.isLoading || overview.isLoading)
    return <StatusPanel kind="loading" title="Loading properties" />;
  if (error || !properties.data) {
    return (
      <StatusPanel
        kind="error"
        title="Could not load properties"
        description={error?.message}
        requestId={error?.requestId}
      />
    );
  }
  const list = properties.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-end gap-2">
        <div className="me-auto">
          <h1 className="text-xl font-semibold">Properties</h1>
          <p className="text-sm text-fg-secondary">
            New confirmation numbers carry each property&apos;s prefix (e.g. SMR-100045).
          </p>
        </div>
        {manage ? (
          <Button
            size="touch"
            className="md:h-control md:text-sm"
            onClick={() => setDialog({ kind: "create" })}
          >
            New property
          </Button>
        ) : null}
      </header>
      <section className="rounded-lg border border-border-subtle bg-surface">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Properties you can access</caption>
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Property
                </th>
                <th scope="col" className="py-2 pe-3 font-medium">
                  Currency
                </th>
                <th scope="col" className="py-2 pe-3 font-medium">
                  Time zone
                </th>
                <th scope="col" className="py-2 pe-3 font-medium">
                  Prefix
                </th>
                <th scope="col" className="py-2 pe-3 font-medium">
                  Business date
                </th>
                <th scope="col" className="py-2 pe-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {list.map((p) => {
                const businessDate = dates.get(p.id) ?? null;
                return (
                  <tr key={p.id}>
                    <th scope="row" className="px-4 py-2 text-left font-medium">
                      <span className="me-2 font-mono text-xs text-fg-muted">{p.code}</span>
                      {p.name}
                    </th>
                    <td className="py-2 pe-3">{p.currencyCode}</td>
                    <td className="py-2 pe-3 text-fg-secondary">{p.timezone}</td>
                    <td className="py-2 pe-3 font-mono text-xs">{p.confirmationPrefix}</td>
                    <td className="py-2 pe-3">
                      {businessDate ? (
                        <span className="font-mono text-xs">{businessDate}</span>
                      ) : (
                        <Badge tone="warning">Not live</Badge>
                      )}
                    </td>
                    <td className="py-2 pe-4">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
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
