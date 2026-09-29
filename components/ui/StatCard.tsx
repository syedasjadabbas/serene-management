import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatTone = "brand" | "info" | "warning" | "danger" | "accent" | "neutral";

const ICON_TONES: Record<StatTone, string> = {
  brand: "bg-brand-muted text-brand",
  info: "bg-info-subtle text-info",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  accent: "bg-accent-subtle text-accent",
  neutral: "bg-surface-sunken text-fg-secondary",
};

/**
 * Compact key figure: tinted icon tile, label, value, one line of context
 * and an optional progress bar (0–100). Deliberately small: a row of four
 * fits a laptop screen without pushing the operational lists below the
 * fold; on phones two sit side by side and the icon tile is dropped. With `href` the whole card links to the detail behind the figure.
 */
export function StatCard({
  icon: Icon,
  tone = "brand",
  label,
  value,
  hint,
  progress,
  href,
  className,
}: {
  icon: LucideIcon;
  tone?: StatTone;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  progress?: number;
  href?: Route | null;
  className?: string;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "hidden size-10 shrink-0 items-center justify-center rounded-md sm:flex",
          ICON_TONES[tone],
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-fg-secondary">{label}</span>
        <span className="text-2xl leading-tight font-semibold text-fg tabular-nums">{value}</span>
        {hint ? <span className="truncate text-xs text-fg-muted">{hint}</span> : null}
        {progress !== undefined ? (
          <span
            aria-hidden="true"
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
          >
            <span
              className="block h-full rounded-full bg-brand"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </span>
        ) : null}
      </span>
    </>
  );
  const base = cn(
    "flex min-w-0 items-start gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-card sm:p-4",
    className,
  );
  return href ? (
    <Link
      href={href}
      className={cn(
        base,
        "transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-raised",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}
