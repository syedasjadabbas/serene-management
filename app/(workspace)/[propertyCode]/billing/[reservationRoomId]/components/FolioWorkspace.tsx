"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Receipt, Plus } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";
import { IdChip, type KeyFact, KeyFacts } from "@/components/ui/KeyFacts";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { cn } from "@/components/ui/cn";
import { useTabs } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useFolioAccountQuery, useOpenWindowMutation } from "@/lib/api/endpoints/billing.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, pluralize } from "@/lib/utils/format";
import { parseMoney } from "@/lib/utils/money";
import type { FolioAccountView, FolioWindowView } from "@/modules/billing/billing.types";
import { PaymentDialog, PostChargeDialog, RoomChargesDialog, SettleDialog } from "./FolioDialogs";
import { FolioHistory } from "./FolioHistory";
import { LedgerView } from "./LedgerView";

type DialogKind = null | "charge" | "roomCharges" | "payment" | "settle";

/**
 * A stay's guest account: header, billing windows, ledger-derived totals and
 * the actions the server allows. Nothing here computes a balance: every
 * figure comes from the ledger through the API.
 */
export function FolioWorkspace({ reservationRoomId }: { reservationRoomId: string }) {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const allowed = can("billing:read");
  const query = useFolioAccountQuery(
    { propertyId: property.id, reservationRoomId },
    { skip: !allowed },
  );
  const error = toClientApiError(query.error);
  const [selected, setSelected] = useState<number>(1);
  const windowNumbers = query.data?.windows.map((w) => w.window) ?? [];
  const windowTabs = useTabs(windowNumbers, selected, setSelected);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [openWindow, openState] = useOpenWindowMutation();
  const openError = toClientApiError(openState.error);

  if (permissionsLoading) return <PageSkeleton title="Loading folio" layout="detail" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the billing:read permission."
      />
    );
  }
  if (query.isLoading) return <PageSkeleton title="Loading folio" layout="detail" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={error?.code === "NOT_FOUND" ? "empty" : "error"}
        title={error?.code === "NOT_FOUND" ? "Folio not found" : "Could not load the folio"}
        description={error?.message}
        requestId={error?.requestId}
        action={
          <Link
            href={`/${property.code}/billing` as Route}
            className="text-sm text-brand hover:underline"
          >
            Back to billing
          </Link>
        }
      />
    );
  }

  const account = query.data;
  const a = account.actions;
  const win = account.windows.find((w) => w.window === selected) ?? account.windows[0] ?? null;
  const money = (value: string) =>
    formatCurrency(value, account.currencyCode, "en", account.minorUnits);

  return (
    <div className="flex w-full flex-col gap-6">
      <Header account={account} />

      {account.windows.length === 0 ? (
        <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
          <StatusPanel
            kind="empty"
            title="No folio yet"
            description={
              account.stayId
                ? "This stay was checked in before billing was enabled. Open window 1 to start its account."
                : "A folio opens when the guest checks in."
            }
            action={
              a.openWindow ? (
                <Button
                  pending={openState.isLoading}
                  onClick={() => void openWindow({ propertyId: property.id, reservationRoomId })}
                >
                  Open folio
                </Button>
              ) : undefined
            }
          />
          {openError ? <Alert tone="danger">{openError.message}</Alert> : null}
        </section>
      ) : (
        <>
          <section
            aria-label="Account totals"
            className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3"
          >
            <Total label="Charges" value={money(account.totals.charges)} />
            <Total label="Payments & credits" value={money(account.totals.credits)} />
            <Total
              label="Balance due"
              value={money(account.totals.balance)}
              emphasis={account.totals.balance !== "0.0000"}
            />
          </section>

          {account.roomCharges.unpostedNights.length > 0 ? (
            <Alert tone="warning">
              {pluralize(account.roomCharges.unpostedNights.length, "past night")} not posted yet (
              {account.roomCharges.unpostedNights.map((n) => formatDate(n)).join(", ")}).
              {a.postRoomCharges ? " Post the room charges before settling." : ""}
            </Alert>
          ) : null}

          <section className="rounded-lg border border-border-subtle bg-surface shadow-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
              <div role="tablist" aria-label="Billing windows" className="flex flex-wrap gap-1">
                {account.windows.map((w) => (
                  <WindowTab
                    key={w.id}
                    win={w}
                    active={w.window === win?.window}
                    currency={account.currencyCode}
                    minorUnits={account.minorUnits}
                    onSelect={() => setSelected(w.window)}
                    tabProps={windowTabs.tab(w.window)}
                  />
                ))}
              </div>
              {a.openWindow ? (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={openState.isLoading}
                  onClick={async () => {
                    const result = await openWindow({ propertyId: property.id, reservationRoomId });
                    if ("data" in result && result.data)
                      setSelected(result.data.windows.at(-1)!.window);
                  }}
                >
                  <Plus aria-hidden="true" className="size-4" />
                  New window
                </Button>
              ) : null}
            </div>

            {win ? (
              <div {...windowTabs.panel}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
                  <p className="text-sm">
                    Window {win.window}
                    {win.payeeName ? ` · ${win.payeeName}` : ""} ·{" "}
                    <span className="font-semibold tabular-nums">{money(win.balance)}</span> due
                  </p>
                  <WindowStatus win={win} />
                </div>
                <div className="flex flex-wrap gap-2 px-4 pt-3">
                  {a.postCharge && win.status !== "CLOSED" ? (
                    <Button onClick={() => setDialog("charge")}>Post charge</Button>
                  ) : null}
                  {a.takePayment && win.status !== "CLOSED" ? (
                    <Button
                      variant="secondary"
                      disabled={parseMoney(win.balance) <= 0n}
                      onClick={() => setDialog("payment")}
                    >
                      Take payment
                    </Button>
                  ) : null}
                  {a.postRoomCharges ? (
                    <Button variant="secondary" onClick={() => setDialog("roomCharges")}>
                      Post room charges
                    </Button>
                  ) : null}
                  {a.settle && win.status === "OPEN" && win.balance === "0.0000" ? (
                    <Button variant="secondary" onClick={() => setDialog("settle")}>
                      Settle window
                    </Button>
                  ) : null}
                </div>
                {openError ? (
                  <div className="px-4 pt-3">
                    <Alert tone="danger">{openError.message}</Alert>
                  </div>
                ) : null}
                {/* Keyed by window: switching windows starts from the first page. */}
                <LedgerView key={win.id} account={account} win={win} />
              </div>
            ) : null}
          </section>

          {a.viewHistory ? <FolioHistory reservationRoomId={reservationRoomId} /> : null}
        </>
      )}

      {win && dialog === "charge" ? (
        <PostChargeDialog account={account} win={win} onClose={() => setDialog(null)} />
      ) : null}
      {win && dialog === "payment" ? (
        <PaymentDialog account={account} win={win} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "roomCharges" ? (
        <RoomChargesDialog account={account} onClose={() => setDialog(null)} />
      ) : null}
      {win && dialog === "settle" ? (
        <SettleDialog account={account} win={win} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function Header({ account }: { account: FolioAccountView }) {
  const property = useProperty();
  const facts: KeyFact[] = [
    {
      label: "Room",
      value: account.room
        ? `${account.room.number} · ${account.roomType.name}`
        : account.roomType.name,
    },
    {
      label: "Stay",
      value: `${formatDate(account.arrival)} → ${formatDate(account.departure)}`,
    },
    {
      label: "Guests",
      value: `${pluralize(account.adults, "adult")}${account.children ? `, ${pluralize(account.children, "child", "children")}` : ""}`,
    },
    {
      label: "Business date",
      value: account.businessDate ? formatDate(account.businessDate) : "—",
    },
  ];
  return (
    <PageHeader
      back={{ href: `/${property.code}/billing`, label: "Billing" }}
      icon={Receipt}
      eyebrow="Folio"
      title={account.guest.name}
      meta={
        <>
          {account.stayStatus === "IN_HOUSE" ? <Badge tone="brand">In house</Badge> : null}
          {account.stayStatus === "CHECKED_OUT" ? <Badge>Checked out</Badge> : null}
        </>
      }
      actions={
        account.stayId ? (
          <Link
            href={`/${property.code}/front-desk/stays/${account.stayId}` as Route}
            className={buttonClass("secondary")}
          >
            View stay
          </Link>
        ) : undefined
      }
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <IdChip label="Confirmation" value={account.confirmation} />
            <IdChip label="Rate plan" value={account.ratePlanCode} />
            <IdChip label="Currency" value={account.currencyCode} />
          </div>
          <KeyFacts items={facts} />
        </div>
      }
    />
  );
}

function Total({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-5 py-4 shadow-card">
      <p className="label-caps">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl tracking-[-0.01em] tabular-nums",
          emphasis ? "font-bold text-fg" : "font-semibold text-fg-secondary",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function WindowTab({
  win,
  active,
  currency,
  minorUnits,
  onSelect,
  tabProps,
}: {
  win: FolioWindowView;
  active: boolean;
  currency: string;
  minorUnits: number;
  onSelect: () => void;
  tabProps: ReturnType<ReturnType<typeof useTabs<number>>["tab"]>;
}) {
  return (
    <button
      type="button"
      {...tabProps}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 flex-col items-start rounded-md px-3 py-1 text-left text-sm",
        active ? "bg-brand-subtle text-brand" : "text-fg-secondary hover:bg-surface-sunken",
      )}
    >
      <span className="font-medium">Window {win.window}</span>
      <span className="text-xs tabular-nums">
        {formatCurrency(win.balance, currency, "en", minorUnits)}
      </span>
    </button>
  );
}

function WindowStatus({ win }: { win: FolioWindowView }) {
  if (win.status === "SETTLED") return <Badge tone="success">Settled</Badge>;
  if (win.status === "CLOSED") return <Badge>Closed</Badge>;
  return <Badge tone="info">Open</Badge>;
}
