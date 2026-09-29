import type { ReactNode } from "react";
import { Count } from "./Badge";
import { cn } from "./cn";

export interface ToggleOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional count shown after the label (e.g. arrivals remaining). */
  count?: number;
}

/**
 * Single-choice filter as a segmented control: one bordered group whose
 * selected segment is raised (white, hairline ring, soft shadow). It is a
 * group of aria-pressed buttons, not tabs: it filters one list rather than
 * switching views. Scrolls horizontally on narrow screens instead of
 * wrapping; segments grow to finger size on touch screens.
 */
export function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("max-w-full overflow-x-auto", className)}>
      <div
        role="group"
        aria-label={label}
        className="inline-flex gap-0.5 rounded-md border border-border-subtle bg-surface-sunken p-0.5"
      >
        {options.map((option) => {
          const pressed = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(option.value)}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-[6px] px-3 text-sm whitespace-nowrap transition-colors duration-150",
                "pointer-coarse:h-10",
                pressed
                  ? "bg-surface font-medium text-fg shadow-raised ring-1 ring-border-subtle"
                  : "text-fg-secondary hover:bg-surface/60 hover:text-fg",
              )}
            >
              {option.label}
              {option.count !== undefined ? <Count>{option.count}</Count> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
