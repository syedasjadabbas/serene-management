import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

/**
 * Full-region state for loading, empty, error and permission-denied views
 * (docs/ARCHITECTURE.md §7.4).
 */
export function StatusPanel({
  kind,
  title,
  description,
  requestId,
  action,
}: {
  kind: "loading" | "empty" | "error" | "forbidden";
  title: string;
  description?: ReactNode;
  requestId?: string | null;
  action?: ReactNode;
}) {
  return (
    <section
      aria-live={kind === "loading" ? "polite" : undefined}
      className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-16 text-center"
    >
      {kind === "loading" ? <Spinner label={title} /> : null}
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      {description ? <div className="text-sm text-fg-secondary">{description}</div> : null}
      {requestId ? (
        <p className="font-mono text-2xs text-fg-muted">Reference: {requestId}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
