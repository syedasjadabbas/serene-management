import { CircleAlert, Inbox, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

const ICONS = {
  empty: { Icon: Inbox, className: "bg-surface-sunken text-fg-muted" },
  error: { Icon: CircleAlert, className: "bg-danger-subtle text-danger" },
  forbidden: { Icon: Lock, className: "bg-surface-sunken text-fg-secondary" },
} as const;

/**
 * Full-region state for loading, empty, error and permission-denied views
 * (docs/DESIGN_SYSTEM.md §States). The title is an h2 inside a page that has
 * its own h1; pass `level={1}` when the panel is the whole page (route error
 * and loading states). Errors and denials are announced to assistive
 * technology. Empty states should say what belongs here and how to add it.
 */
export function StatusPanel({
  kind,
  title,
  description,
  requestId,
  action,
  level = 2,
}: {
  kind: "loading" | "empty" | "error" | "forbidden";
  title: string;
  description?: ReactNode;
  requestId?: string | null;
  action?: ReactNode;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  const icon = kind === "loading" ? null : ICONS[kind];
  return (
    <section
      role={kind === "error" || kind === "forbidden" ? "alert" : undefined}
      className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-14 text-center"
    >
      {kind === "loading" ? <Spinner label={title} className="mb-1" /> : null}
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "mb-1 flex size-10 items-center justify-center rounded-full",
            icon.className,
          )}
        >
          <icon.Icon className="size-5" />
        </span>
      ) : null}
      <Heading className="text-lg font-semibold text-fg">{title}</Heading>
      {description ? (
        <div className="text-sm text-pretty text-fg-secondary">{description}</div>
      ) : null}
      {requestId ? (
        <p className="font-mono text-2xs text-fg-muted">Reference: {requestId}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
