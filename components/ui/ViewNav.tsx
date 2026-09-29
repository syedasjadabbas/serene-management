import type { ReactNode } from "react";
import { Count } from "./Badge";
import { cn } from "./cn";

export interface ViewNavItem<T extends string> {
  key: T;
  label: ReactNode;
  /** Optional count after the label (e.g. open tasks). */
  count?: number;
}

/**
 * Switches between the views of a workspace page (housekeeping board and
 * task lists, maintenance work states) when each view is its own URL. It
 * looks like the tab bar (white bordered bar, selected view as a mint pill
 * in brand green) but is navigation: buttons with `aria-current="page"`, so
 * the view survives reloads and Back. Scrolls sideways on narrow screens
 * without a visible scrollbar.
 */
export function ViewNav<T extends string>({
  label,
  items,
  value,
  onChange,
  className,
}: {
  label: string;
  items: readonly ViewNavItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("max-w-full", className)}>
      <ul className="scrollbar-hidden inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border-subtle bg-surface p-1 shadow-card">
        {items.map((item) => {
          const current = item.key === value;
          return (
            <li key={item.key} className="shrink-0">
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                onClick={() => onChange(item.key)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-2 rounded-md px-3.5 text-sm whitespace-nowrap transition-colors duration-150 pointer-coarse:min-h-11",
                  current
                    ? "bg-brand-subtle font-semibold text-brand"
                    : "font-medium text-fg-secondary hover:bg-surface-sunken hover:text-fg",
                )}
              >
                {item.label}
                {item.count !== undefined ? <Count>{item.count}</Count> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
