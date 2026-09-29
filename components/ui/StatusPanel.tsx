import { CircleAlert, Inbox, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { BrandLoader } from "@/components/brand/BrandLoader";
import { Skeleton } from "./Skeleton";

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
  if (kind === "loading" && level === 2) {
    // A region inside a page (a ledger, a history, a result list) loads as
    // quiet skeleton lines where it will appear; the title is announced.
    return (
      <section role="status" className="flex flex-col gap-3 px-4 py-6">
        <span className="sr-only">{title}</span>
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </section>
    );
  }
  if (kind === "loading") {
    // A whole page before the shell exists (session restore, first load)
    // uses the brand loader; the title keeps the panel's heading level.
    return (
      <section
        className={cn("mx-auto flex max-w-md justify-center px-4", level === 1 ? "py-14" : "py-10")}
      >
        <BrandLoader
          title={title}
          description={typeof description === "string" ? description : undefined}
          size={level === 1 ? "lg" : "md"}
          heading={level}
        />
      </section>
    );
  }
  const Heading = level === 1 ? "h1" : "h2";
  const icon = ICONS[kind];
  return (
    <section
      role={kind === "error" || kind === "forbidden" ? "alert" : undefined}
      className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-14 text-center"
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "mb-1 flex size-11 items-center justify-center rounded-md border border-current/10",
            icon.className,
          )}
        >
          <icon.Icon className="size-5" />
        </span>
      ) : null}
      <Heading className="text-lg font-semibold tracking-[-0.01em] text-fg">{title}</Heading>
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
