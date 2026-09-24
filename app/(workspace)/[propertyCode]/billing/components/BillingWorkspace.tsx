"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useBillingOptionsQuery, useFoliosQuery } from "@/lib/api/endpoints/billing.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { FOLIO_VIEWS, type FolioListView } from "@/modules/billing/billing.schema";
import type { FolioListRow } from "@/modules/billing/billing.types";

const VIEW_LABELS: Record<FolioListView, string> = {
  in_house: "In house",
  open_balance: "Open balance",
  all: "All folios",
};

/** Guest accounts: pick a stay to open its folio. Balances come from the ledger. */
export function BillingWorkspace() {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (FOLIO_VIEWS as readonly string[]).includes(params.get("view") ?? "")
    ? (params.get("view") as FolioListView)
    : "in_house";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);

  const setParam = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setCursors([undefined]);
    router.replace(`${pathname}?${next.toString()}` as Route);
  };

  if (permissionsLoading) return <StatusPanel kind="loading" title="Loading billing" />;
  if (!can("billing:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the billing:read permission."
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Billing</h1>
          <p className="text-sm text-fg-muted">
            Guest folios in {property.currencyCode}. Open a stay to post charges and take payments.
          </p>
        </div>
        <form
          className="flex w-full items-end gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault();
            setParam({ q: search.trim() });
          }}
          role="search"
        >
          <TextField
            label="Guest, confirmation or room"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 sm:w-64"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      <div role="tablist" aria-label="Folio views" className="flex flex-wrap gap-1">
        {FOLIO_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setParam({ view: v === "in_house" ? "" : v })}
            className={cn(
              "min-h-11 rounded-md px-3 text-sm",
              view === v
                ? "bg-brand-subtle font-medium text-brand"
                : "text-fg-secondary hover:bg-surface-sunken",
            )}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
        {cursors.map((cursor, index) => (
          <FolioPage
            key={cursor ?? "first"}
            view={view}
            q={q}
            cursor={cursor}
            first={index === 0}
            last={index === cursors.length - 1}
            onMore={(next) => setCursors((list) => [...list, next])}
          />
        ))}
      </section>
    </div>
  );
}

function FolioPage({
  view,
  q,
  cursor,
  first,
  last,
  onMore,
}: {
  view: FolioListView;
  q: string;
  cursor: string | undefined;
  first: boolean;
  last: boolean;
  onMore: (cursor: string) => void;
}) {
  const property = useProperty();
  const query = useFoliosQuery({ propertyId: property.id, view, q: q || undefined, cursor });
  const error = toClientApiError(query.error);
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading folios" />;
  if (error) {
    return (
      <StatusPanel
        kind="error"
        title="Could not load folios"
        description={error.message}
        requestId={error.requestId}
      />
    );
  }
  const rows = query.data?.items ?? [];
  if (first && rows.length === 0) {
    return (
      <StatusPanel
        kind="empty"
        title={q ? "No matching guests" : "No folios in this view"}
        description={view === "open_balance" ? "Every account is settled." : undefined}
      />
    );
  }
  return (
    <>
      <ul
        className={cn("divide-y divide-border-subtle", !first && "border-t border-border-subtle")}
      >
        {rows.map((row) => (
          <FolioRow key={row.reservationRoomId} row={row} />
        ))}
      </ul>
      {last && query.data?.meta.nextCursor ? (
        <div className="border-t border-border-subtle p-3 text-center">
          <Button variant="secondary" onClick={() => onMore(query.data!.meta.nextCursor!)}>
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function FolioRow({ row }: { row: FolioListRow }) {
  const property = useProperty();
  const minorUnits = useBillingOptionsQuery(property.id).data?.minorUnits ?? 2;
  const owing = row.balance !== "0.0000";
  return (
    <li>
      <Link
        href={`/${property.code}/billing/${row.reservationRoomId}` as Route}
        className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-surface-sunken sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,2fr)_auto]"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.guestName}</span>
          <span className="text-xs text-fg-muted">{row.confirmation}</span>
        </span>
        <span className="text-sm sm:order-none">
          {row.roomNumber ? `Room ${row.roomNumber}` : "No room"}
        </span>
        <span className="col-span-2 text-xs text-fg-muted sm:col-span-1 sm:text-sm">
          {formatDate(row.arrival)} → {formatDate(row.departure)}
          {row.stayStatus === "CHECKED_OUT" ? " · checked out" : ""}
        </span>
        <span className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:justify-end">
          {row.status === null ? (
            <Badge>No folio</Badge>
          ) : row.status === "SETTLED" ? (
            <Badge tone="success">Settled</Badge>
          ) : null}
          <span className={cn("font-medium tabular-nums", owing ? "text-fg" : "text-fg-muted")}>
            {formatCurrency(row.balance, row.currencyCode, "en", minorUnits)}
          </span>
        </span>
      </Link>
    </li>
  );
}
