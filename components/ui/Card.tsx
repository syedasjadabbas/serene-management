import { type ReactNode, useId } from "react";
import { cn } from "./cn";

/**
 * A working surface: white on the neutral canvas, hairline border, soft
 * shadow, 12px radius. With `title` it renders a header row (title, description,
 * actions) and is labelled by it. `flush` removes body padding for tables
 * and lists that run edge to edge. Never nest cards; use dividers inside.
 */
export function Card({
  title,
  description,
  actions,
  level = 2,
  flush = false,
  as: Tag = "section",
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  flush?: boolean;
  as?: "section" | "div" | "article";
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <Tag
      aria-labelledby={title && Tag !== "div" ? titleId : undefined}
      className={cn(
        "min-w-0 rounded-lg border border-border-subtle bg-surface shadow-card",
        className,
      )}
    >
      {title ? (
        <div
          className={cn(
            "flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-4",
            flush ? "border-b border-border-subtle pb-3" : "pb-0",
          )}
        >
          <div className="min-w-0 flex-1">
            <Heading id={titleId} className="text-lg font-semibold text-fg">
              {title}
            </Heading>
            {description ? (
              <div className="mt-0.5 text-xs text-fg-secondary">{description}</div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={cn(!flush && (title ? "px-5 pt-3 pb-5" : "p-5"), bodyClassName)}>
        {children}
      </div>
    </Tag>
  );
}
