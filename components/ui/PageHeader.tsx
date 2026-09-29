import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { Fragment, type ReactNode } from "react";
import { cn } from "./cn";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Top of every workspace page (SERENE family header, shared with
 * SALESTORM): a white header surface with an optional icon tile, a
 * breadcrumb trail (or a back link on record pages), an optional eyebrow
 * (record type), the page's only h1, a one-line description, optional meta
 * (status pills, identifiers) and the page actions on the end (primary last).
 * `footer` sits under a hairline inside the same surface: record key facts,
 * identifier chips or a page's view switcher. Stacks below sm; actions wrap
 * instead of overflowing.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  back,
  breadcrumbs,
  icon: Icon,
  eyebrow,
  footer,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Trail above the title; the last crumb is the current page. */
  breadcrumbs?: Crumb[];
  /** Module or record icon shown in a mint tile before the title. */
  icon?: LucideIcon;
  /** Small uppercase record type above a record's name ("Reservation"). */
  eyebrow?: string;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn("rounded-xl border border-border-subtle bg-surface shadow-card", className)}
    >
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-start gap-3.5">
          {Icon ? (
            <span
              aria-hidden="true"
              className="mt-0.5 hidden size-11 shrink-0 items-center justify-center rounded-md border border-brand/15 bg-brand-subtle text-brand sm:flex"
            >
              <Icon className="size-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            {back ? (
              <Link
                href={back.href as Route}
                className="mb-1 inline-flex min-h-6 items-center gap-1 text-xs font-medium text-fg-secondary hover:text-fg"
              >
                <ChevronLeft aria-hidden="true" className="size-3.5 rtl:rotate-180" />
                {back.label}
              </Link>
            ) : breadcrumbs?.length ? (
              <nav aria-label="Breadcrumb" className="mb-0.5">
                <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
                  {breadcrumbs.map((crumb, index) => {
                    const last = index === breadcrumbs.length - 1;
                    return (
                      <Fragment key={`${crumb.label}-${index}`}>
                        <li>
                          {crumb.href && !last ? (
                            <Link
                              href={crumb.href as Route}
                              className="inline-flex min-h-6 items-center hover:text-fg hover:underline"
                            >
                              {crumb.label}
                            </Link>
                          ) : (
                            <span
                              aria-current={last ? "page" : undefined}
                              className="inline-flex min-h-6 items-center"
                            >
                              {crumb.label}
                            </span>
                          )}
                        </li>
                        {!last ? (
                          <li aria-hidden="true">
                            <ChevronRight className="size-3 text-fg-muted rtl:rotate-180" />
                          </li>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </ol>
              </nav>
            ) : null}
            {eyebrow ? <p className="mb-0.5 label-caps">{eyebrow}</p> : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-2xl font-bold tracking-[-0.02em] break-words text-fg">{title}</h1>
              {meta}
            </div>
            {description ? (
              <p className="mt-1 max-w-[72ch] text-sm text-pretty text-fg-secondary">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {footer ? (
        <div className="border-t border-border-subtle px-5 py-4 sm:px-6">{footer}</div>
      ) : null}
    </header>
  );
}
