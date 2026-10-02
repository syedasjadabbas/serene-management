"use client";

import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { Receipt } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
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
  // Load-more cursors belong to one query; any URL change (tab, search, Back,
  // a nav link) starts again from the first page.
  const listKey = `${view}|${q}`;
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key: listKey,
    cursors: [undefined],
  });
  const cursors = pages.key === listKey ? pages.cursors : [undefined];

  const setParam = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const search = next.toString();
    router.replace((search ? `${pathname}?${search}` : pathname) as Route);
  };

  if (permissionsLoading) return <PageSkeleton title="Loading billing" />;
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
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Receipt}
        breadcrumbs={[{ label: property.code, href: `/${property.code}` }, { label: "Billing" }]}
        title="Billing"
        description={`Guest folios in ${property.currencyCode}. Open a stay to post charges and take payments.`}
        actions={<SearchForm key={q} q={q} onSearch={(value) => setParam({ q: value })} />}
      />

      <ToggleGroup
        label="Folio views"
        options={FOLIO_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
        value={view}
        onChange={(v) => setParam({ view: v === "in_house" ? "" : v })}
      />

      <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-card">
        {cursors.map((cursor, index) => (
          <FolioPage
            key={`${listKey}-${cursor ?? "first"}`}
            view={view}
            q={q}
            cursor={cursor}
            first={index === 0}
            last={index === cursors.length - 1}
            onMore={(next) => setPages({ key: listKey, cursors: [...cursors, next] })}
            onClearSearch={() => setParam({ q: "" })}
          />
        ))}
      </section>
    </div>
  );
}

/** Search box; keyed by `q` so it re-initialises whenever the URL search changes. */
function SearchForm({ q, onSearch }: { q: string; onSearch: (value: string) => void }) {
  const [search, setSearch] = useState(q);
  return (
    <form
      className="flex w-full items-end gap-2 sm:w-auto"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(search.trim());
      }}
      role="search"
    >
      <TextField
        label="Guest, confirmation or room"
        value={search}
        maxLength={100}
        onChange={(e) => setSearch(e.target.value)}
        className="min-w-0 flex-1 sm:w-64"
      />
      <Button type="submit" variant="secondary">
        Search
      </Button>
      {q ? (
        <Button type="button" variant="ghost" onClick={() => onSearch("")}>
          Clear
        </Button>
      ) : null}
    </form>
  );
}

function FolioPage({
  view,
  q,
  cursor,
  first,
  last,
  onMore,
  onClearSearch,
}: {
  view: FolioListView;
  q: string;
  cursor: string | undefined;
  first: boolean;
  last: boolean;
  onMore: (cursor: string) => void;
  onClearSearch: () => void;
}) {
  const property = useProperty();
  const query = useFoliosQuery({ propertyId: property.id, view, q: q || undefined, cursor });
  const error = toClientApiError(query.error);
  // currentData is only ever this page's args; never show another query's rows.
  const data = query.currentData;
  if (error) {
    return (
      <StatusPanel
        kind="error"
        title="Could not load folios"
        description={error.message}
        requestId={error.requestId}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!data) return <StatusPanel kind="loading" title="Loading folios" />;
  const rows = data.items;
  if (first && rows.length === 0) {
    return (
      <StatusPanel
        kind="empty"
        title={q ? "No matching guests" : "No folios in this view"}
        description={
          q
            ? "Try another name, confirmation or room number."
            : view === "open_balance"
              ? "Every account is settled."
              : undefined
        }
        action={
          q ? (
            <Button variant="secondary" onClick={onClearSearch}>
              Clear search
            </Button>
          ) : undefined
        }
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
      {last && data.meta.nextCursor ? (
        <div className="border-t border-border-subtle p-3 text-center">
          <Button
            variant="secondary"
            pending={query.isFetching}
            disabled={query.isFetching}
            onClick={() => onMore(data.meta.nextCursor!)}
          >
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
        className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-surface-sunken sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,2fr)_11rem]"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.guestName}</span>
          <span className="font-mono text-xs text-fg-muted">{row.confirmation}</span>
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
