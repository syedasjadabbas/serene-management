import type { ReactNode } from "react";
import { cn } from "./cn";

export interface Fact {
  label: string;
  value: ReactNode;
  /** Span the full width (long values such as notes or policies). */
  wide?: boolean;
}

/**
 * Label/value pairs for record details (reservation, stay, folio, guest):
 * small muted labels over charcoal values in a responsive grid.
 */
export function FactList({
  items,
  columns = 2,
  className,
}: {
  items: Fact[];
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2",
        columns === 3 && "xl:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "min-w-0",
            item.wide && "sm:col-span-2",
            item.wide && columns === 3 && "xl:col-span-3",
          )}
        >
          <dt className="text-xs text-fg-muted">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
