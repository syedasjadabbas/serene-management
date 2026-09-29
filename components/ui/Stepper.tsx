import { Check } from "lucide-react";
import { cn } from "./cn";

export interface Step {
  label: string;
  state: "done" | "current" | "upcoming";
  /** Steps the user may jump to; others are shown but not clickable. */
  onSelect?: () => void;
}

/**
 * Progress through a multi-step workflow (booking, and later check-in or
 * night audit): numbered circles joined by a line, done steps ticked, the
 * current one marked with aria-current="step". Reachable steps are buttons.
 * On narrow screens only the current step keeps its label.
 */
export function Stepper({ label, steps }: { label: string; steps: Step[] }) {
  return (
    <nav aria-label={label}>
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const marker = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  step.state === "done" && "border-brand bg-brand text-brand-fg",
                  step.state === "current" && "border-brand bg-brand-subtle text-brand",
                  step.state === "upcoming" && "border-border bg-surface text-fg-muted",
                )}
              >
                {step.state === "done" ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-sm whitespace-nowrap",
                  step.state === "current"
                    ? "font-medium text-fg"
                    : "hidden text-fg-secondary sm:inline",
                )}
              >
                {step.label}
              </span>
              {step.state === "done" ? <span className="sr-only"> (completed)</span> : null}
            </>
          );
          return (
            <li key={step.label} className="flex min-w-0 items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="h-px w-4 shrink-0 bg-border sm:w-8" />
              ) : null}
              {step.onSelect && step.state !== "current" ? (
                <button
                  type="button"
                  onClick={step.onSelect}
                  className="flex min-h-11 items-center gap-2 rounded-md px-1 hover:bg-surface-sunken md:min-h-8"
                >
                  {marker}
                </button>
              ) : (
                <span
                  aria-current={step.state === "current" ? "step" : undefined}
                  className="flex min-h-8 items-center gap-2 px-1"
                >
                  {marker}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
