"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { addDays } from "@/modules/business-date/business-date.policy";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { controlClass } from "./field";

/**
 * Previous day · date · next day · jump to the business date. Used by
 * date-driven screens (availability, and later room board and rate
 * calendar). Dates are YYYY-MM-DD strings; `min` blocks earlier dates (e.g.
 * the business date for new stays). The date field has a visible label only
 * for screen readers; the surrounding screen names what the date means.
 */
export function DateNavigator({
  label,
  value,
  onChange,
  min,
  today,
  todayLabel = "Today",
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
  min?: string;
  /** The date "Today" jumps to (the hotel business date, never the browser date). */
  today?: string;
  todayLabel?: string;
}) {
  const id = useId();
  const previous = addDays(value, -1);
  const atMin = min !== undefined && previous < min;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <IconButton
        label="Previous day"
        variant="secondary"
        disabled={atMin}
        onClick={() => onChange(previous)}
      >
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
      </IconButton>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        className={controlClass(false, "h-control px-2.5 font-mono tabular-nums")}
      />
      <IconButton label="Next day" variant="secondary" onClick={() => onChange(addDays(value, 1))}>
        <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
      </IconButton>
      {today ? (
        <Button variant="ghost" disabled={value === today} onClick={() => onChange(today)}>
          {todayLabel}
        </Button>
      ) : null}
    </div>
  );
}
