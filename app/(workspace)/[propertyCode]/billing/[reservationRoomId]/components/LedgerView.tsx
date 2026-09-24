"use client";

import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { cn } from "@/components/ui/cn";
import { useProperty } from "@/hooks/useProperty";
import { useFolioLedgerQuery } from "@/lib/api/endpoints/billing.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils/format";
import type {
  FolioAccountView,
  FolioWindowView,
  LedgerItemView,
} from "@/modules/billing/billing.types";
import { AdjustDialog, RefundDialog, ReverseDialog, VoidDialog } from "./FolioDialogs";

type Correction = { kind: "reverse" | "adjust" | "void" | "refund"; item: LedgerItemView } | null;

const KIND_LABELS: Record<string, string> = {
  CHARGE: "Charge",
  TAX: "Tax",
  PAYMENT: "Payment",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

/**
 * The window's ledger in posting order with the running balance computed by
 * the database. Posted lines are never edited: corrections are explicit
 * reverse / adjust / void / refund commands that append new lines.
 */
export function LedgerView({ account, win }: { account: FolioAccountView; win: FolioWindowView }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [correction, setCorrection] = useState<Correction>(null);
  return (
    <div className="mt-3 border-t border-border-subtle">
      {/* relative: keeps the sr-only header label inside the scroll container. */}
      <div className="relative overflow-x-auto">
        <table className="hidden w-full text-sm md:table">
          <caption className="sr-only">Ledger of window {win.window}</caption>
          <thead className="bg-surface-sunken text-left text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Business date
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Description
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Code
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Debit
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Credit
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Balance
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {cursors.map((cursor, index) => (
            <LedgerPageRows
              key={cursor ?? "first"}
              account={account}
              win={win}
              cursor={cursor}
              first={index === 0}
              last={index === cursors.length - 1}
              layout="table"
              onMore={(next) => setCursors((list) => [...list, next])}
              onCorrect={setCorrection}
            />
          ))}
        </table>
        <div className="md:hidden">
          {cursors.map((cursor, index) => (
            <LedgerPageRows
              key={cursor ?? "first"}
              account={account}
              win={win}
              cursor={cursor}
              first={index === 0}
              last={index === cursors.length - 1}
              layout="cards"
              onMore={(next) => setCursors((list) => [...list, next])}
              onCorrect={setCorrection}
            />
          ))}
        </div>
      </div>

      {correction?.kind === "reverse" ? (
        <ReverseDialog
          account={account}
          item={correction.item}
          onClose={() => setCorrection(null)}
        />
      ) : null}
      {correction?.kind === "adjust" ? (
        <AdjustDialog
          account={account}
          item={correction.item}
          onClose={() => setCorrection(null)}
        />
      ) : null}
      {correction?.kind === "void" ? (
        <VoidDialog account={account} item={correction.item} onClose={() => setCorrection(null)} />
      ) : null}
      {correction?.kind === "refund" ? (
        <RefundDialog
          account={account}
          item={correction.item}
          onClose={() => setCorrection(null)}
        />
      ) : null}
    </div>
  );
}

function LedgerPageRows({
  account,
  win,
  cursor,
  first,
  last,
  layout,
  onMore,
  onCorrect,
}: {
  account: FolioAccountView;
  win: FolioWindowView;
  cursor: string | null;
  first: boolean;
  last: boolean;
  layout: "table" | "cards";
  onMore: (cursor: string) => void;
  onCorrect: (correction: Correction) => void;
}) {
  const property = useProperty();
  const query = useFolioLedgerQuery({ propertyId: property.id, folioId: win.id, cursor });
  const error = toClientApiError(query.error);
  const wrap = (content: ReactNode) =>
    layout === "table" ? (
      <tbody>
        <tr>
          <td colSpan={7}>{content}</td>
        </tr>
      </tbody>
    ) : (
      <div>{content}</div>
    );

  if (query.isLoading) return wrap(<StatusPanel kind="loading" title="Loading ledger" />);
  if (error) {
    return wrap(
      <StatusPanel
        kind="error"
        title="Could not load the ledger"
        description={error.message}
        requestId={error.requestId}
      />,
    );
  }
  const items = query.data?.items ?? [];
  if (first && items.length === 0) {
    return wrap(
      <StatusPanel
        kind="empty"
        title="No postings yet"
        description="Charges and payments on this window appear here."
      />,
    );
  }
  const more =
    last && query.data?.nextCursor ? (
      <div className="border-t border-border-subtle p-3 text-center">
        <Button variant="secondary" onClick={() => onMore(query.data!.nextCursor!)}>
          Load more
        </Button>
      </div>
    ) : null;

  if (layout === "table") {
    return (
      <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
        {items.map((item) => (
          <tr key={item.id} className={cn(item.parentItemId && "text-fg-secondary")}>
            <td className="px-4 py-2 align-top whitespace-nowrap">
              {formatDate(item.businessDate)}
              <span className="block text-xs text-fg-muted">
                {formatDateTime(item.postedAt, property.timezone)}
              </span>
            </td>
            <td className={cn("px-2 py-2 align-top", item.parentItemId && "pl-6")}>
              <Description item={item} account={account} />
            </td>
            <td className="px-2 py-2 align-top whitespace-nowrap">
              {item.code.code}
              <span className="block text-xs text-fg-muted">
                {KIND_LABELS[item.kind] ?? item.kind}
              </span>
            </td>
            <td className="px-2 py-2 text-right align-top tabular-nums">
              {item.amount.startsWith("-")
                ? ""
                : formatCurrency(item.amount, account.currencyCode, "en", account.minorUnits)}
            </td>
            <td className="px-2 py-2 text-right align-top tabular-nums">
              {item.amount.startsWith("-")
                ? formatCurrency(
                    item.amount.slice(1),
                    account.currencyCode,
                    "en",
                    account.minorUnits,
                  )
                : ""}
            </td>
            <td className="px-2 py-2 text-right align-top font-medium tabular-nums">
              {formatCurrency(item.runningBalance, account.currencyCode, "en", account.minorUnits)}
            </td>
            <td className="px-4 py-2 align-top">
              <RowActions item={item} onCorrect={onCorrect} />
            </td>
          </tr>
        ))}
        {more ? (
          <tr>
            <td colSpan={7}>{more}</td>
          </tr>
        ) : null}
      </tbody>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border-subtle border-t border-border-subtle">
        {items.map((item) => {
          const credit = item.amount.startsWith("-");
          return (
            <li
              key={item.id}
              className={cn("flex flex-col gap-1 px-4 py-3", item.parentItemId && "pl-8")}
            >
              <div className="flex items-start justify-between gap-3">
                <Description item={item} account={account} />
                <span className={cn("shrink-0 font-medium tabular-nums", credit && "text-success")}>
                  {credit ? "−" : ""}
                  {formatCurrency(
                    credit ? item.amount.slice(1) : item.amount,
                    account.currencyCode,
                    "en",
                    account.minorUnits,
                  )}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 text-xs text-fg-muted">
                <span>
                  {formatDate(item.businessDate)} · {item.code.code} ·{" "}
                  {KIND_LABELS[item.kind] ?? item.kind}
                </span>
                <span className="tabular-nums">
                  Balance{" "}
                  {formatCurrency(
                    item.runningBalance,
                    account.currencyCode,
                    "en",
                    account.minorUnits,
                  )}
                </span>
              </div>
              <RowActions item={item} onCorrect={onCorrect} />
            </li>
          );
        })}
      </ul>
      {more}
    </>
  );
}

function Description({ item, account }: { item: LedgerItemView; account: FolioAccountView }) {
  const details = [
    item.quantity !== "1.000" && item.kind === "CHARGE"
      ? `${Number.parseInt(item.quantity, 10)} × ${formatCurrency(item.unitAmount, account.currencyCode, "en", account.minorUnits)}`
      : null,
    item.reference ? `Ref ${item.reference}` : null,
    item.revenueDate && item.revenueDate !== item.businessDate
      ? `Night of ${formatDate(item.revenueDate)}`
      : null,
    item.postedBy ? `by ${item.postedBy}` : item.source === "SYSTEM" ? "system" : null,
  ].filter(Boolean);
  return (
    <div className="min-w-0">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="break-words">{item.description}</span>
        {item.reversed && !item.payment ? <Badge tone="warning">Reversed</Badge> : null}
        {item.adjusted !== "0.0000" ? <Badge tone="info">Adjusted</Badge> : null}
        {item.payment?.status === "VOIDED" && !item.correctsItemId ? (
          <Badge tone="warning">Voided</Badge>
        ) : null}
      </span>
      {details.length > 0 ? (
        <span className="block text-xs text-fg-muted">{details.join(" · ")}</span>
      ) : null}
      {item.comment ? <span className="block text-xs text-fg-muted">“{item.comment}”</span> : null}
    </div>
  );
}

function RowActions({
  item,
  onCorrect,
}: {
  item: LedgerItemView;
  onCorrect: (correction: Correction) => void;
}) {
  const actions = (
    [
      ["reverse", "Reverse"],
      ["adjust", "Adjust"],
      ["void", "Void"],
      ["refund", "Refund"],
    ] as const
  ).filter(([kind]) => item.actions[kind]);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 md:justify-end">
      {actions.map(([kind, label]) => (
        <Button
          key={kind}
          size="sm"
          variant="ghost"
          className="min-h-11 md:min-h-0"
          aria-label={`${label} ${item.description}`}
          onClick={() => onCorrect({ kind, item })}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
