import type { ReactNode } from "react";
import { cn } from "./cn";

export interface KeyFact {
  label: string;
  value: ReactNode;
  /** One line of context under the value. */
  hint?: ReactNode;
  /** Monospace value (dates, codes, amounts). */
  mono?: boolean;
}

/**
 * Summary tiles for a record (SERENE family): a row of quiet sunken tiles,
 * each an uppercase micro-label over its value. Used in a record header's
 * footer or at the top of a record page for the facts staff check first
 * (stay dates, balance, room, status). Two per row on phones, up to four.
 */
export function KeyFacts({ items, className }: { items: KeyFact[]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:gap-3",
        items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "lg:grid-cols-3" : "",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 rounded-md border border-border-subtle bg-surface-sunken/60 px-3.5 py-3"
        >
          <dt className="truncate label-caps">{item.label}</dt>
          <dd
            className={cn(
              "mt-1 text-sm font-semibold break-words text-fg",
              item.mono && "font-mono tabular-nums",
            )}
          >
            {item.value}
          </dd>
          {item.hint ? (
            <dd className="mt-0.5 truncate text-xs text-fg-muted">{item.hint}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * Identifier chip (confirmation number, room, folio): a bordered pill with an
 * uppercase label and a monospace value, as SALESTORM shows lead codes.
 */
export function IdChip({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-3 shadow-card",
        className,
      )}
    >
      <span className="label-caps">{label}</span>
      <span className="font-mono text-sm font-semibold text-fg">{value}</span>
    </span>
  );
}
