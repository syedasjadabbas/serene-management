"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Count } from "./Badge";
import { Button } from "./Button";
import { cn } from "./cn";

/**
 * Filter bar for list screens (reservations, and later front desk, billing,
 * guests): a search row (search field, Search, More filters, Clear), an
 * optional quick-filter row (usually a ToggleGroup that applies at once) and
 * an optional advanced panel that opens below. It is a search form: Enter
 * submits. The panel starts open when advanced filters are active.
 */
export function FilterBar({
  label,
  search,
  quick,
  advanced,
  advancedCount = 0,
  onSubmit,
  onClear,
  submitLabel = "Search",
  className,
}: {
  /** Accessible name of the search form. */
  label: string;
  search: ReactNode;
  quick?: ReactNode;
  advanced?: ReactNode;
  /** How many advanced filters are set (shown on the toggle). */
  advancedCount?: number;
  onSubmit: () => void;
  onClear?: () => void;
  submitLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(advancedCount > 0);
  const panelId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      role="search"
      aria-label={label}
      onSubmit={submit}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-card sm:p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-60">{search}</div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{submitLabel}</Button>
          {advanced ? (
            <Button
              variant="secondary"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((value) => !value)}
            >
              <SlidersHorizontal aria-hidden="true" className="size-4" />
              Filters
              {advancedCount > 0 ? <Count>{advancedCount}</Count> : null}
            </Button>
          ) : null}
          {onClear ? (
            <Button variant="ghost" onClick={onClear}>
              <X aria-hidden="true" className="size-4" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      {quick ? <div className="min-w-0">{quick}</div> : null}
      {advanced ? (
        <div id={panelId} hidden={!open} className="border-t border-border-subtle pt-3">
          {advanced}
        </div>
      ) : null}
    </form>
  );
}
