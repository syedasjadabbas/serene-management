import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

/**
 * Full-region state for loading, empty, error and permission-denied views
 * (docs/ARCHITECTURE.md §7.4). The title is an h2 inside a page that has its
 * own h1; pass `level={1}` when the panel is the whole page (route error and
 * loading states). Errors and denials are announced to assistive technology.
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
  return (
    <section
      role={kind === "error" || kind === "forbidden" ? "alert" : undefined}
      className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-16 text-center"
    >
      {kind === "loading" ? <Spinner label={title} /> : null}
      <Heading className="text-lg font-semibold text-fg">{title}</Heading>
      {description ? <div className="text-sm text-fg-secondary">{description}</div> : null}
      {requestId ? (
        <p className="font-mono text-2xs text-fg-muted">Reference: {requestId}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
