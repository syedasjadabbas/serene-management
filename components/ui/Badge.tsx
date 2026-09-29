import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-sunken text-fg-secondary",
  brand: "border-brand/25 bg-brand-subtle text-brand",
  accent: "border-accent/25 bg-accent-subtle text-accent",
  success: "border-success/25 bg-success-subtle text-success",
  warning: "border-warning/25 bg-warning-subtle text-warning",
  danger: "border-danger/25 bg-danger-subtle text-danger",
  info: "border-info/25 bg-info-subtle text-info",
};

/**
 * Status tag: a small squared label (5px corners, hairline border in the
 * tone, light tint), sized to sit on a 40px table row without dominating
 * it. Always carries text, never colour alone. Tone follows meaning:
 * success = done/available, warning = needs attention soon,
 * danger = blocked/overdue/cancelled, info = scheduled/in progress,
 * brand = the product's own state (e.g. confirmed), accent = loyalty/VIP.
 * `dot` adds a leading marker for scanning long lists.
 */
export function Badge({
  tone = "neutral",
  dot = false,
  children,
  className,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-[5px] border px-1.5 text-xs leading-none font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** Numeric count next to a tab or filter label (e.g. "Arrivals 24"). */
export function Count({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-[4px] bg-surface-sunken px-1 text-2xs font-semibold text-fg-secondary tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Coloured dot plus label, for legends and dense status columns. */
export function StatusDot({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  const color: Record<BadgeTone, string> = {
    neutral: "bg-fg-muted",
    brand: "bg-brand",
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-fg-secondary", className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", color[tone])} />
      {children}
    </span>
  );
}
