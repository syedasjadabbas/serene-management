import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { Fragment, type ReactNode } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Top of every workspace page: a breadcrumb trail (or a back link on detail
 * pages), the page's only h1, a one-line description, optional meta (badges,
 * identifiers) and the page actions (primary last, so it sits at the end of
 * the row). Stacks below sm; actions wrap instead of overflowing.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  back,
  breadcrumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Trail above the title; the last crumb is the current page. */
  breadcrumbs?: Crumb[];
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back ? (
          <Link
            href={back.href as Route}
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-fg-secondary hover:text-fg"
          >
            <ChevronLeft aria-hidden="true" className="size-3.5 rtl:rotate-180" />
            {back.label}
          </Link>
        ) : breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-secondary">
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
                        <span aria-current={last ? "page" : undefined}>{crumb.label}</span>
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
          {meta}
        </div>
        {description ? (
          <p className="mt-1 max-w-[70ch] text-sm text-pretty text-fg-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
