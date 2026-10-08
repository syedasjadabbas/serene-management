"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { highlight, matches } from "@/components/ui/listbox";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { Disclosure } from "./Disclosure";
import { canUseOrganizationWorkspace, organizationHomeHref, switchHref } from "./sections";

/**
 * Switches between the organization workspace and the user's properties.
 * Switching is plain navigation; the server re-authorizes the new URL.
 * The list is exactly `GET /me`: the properties the user's role assignments
 * reach, plus the organization workspace when any of its sections is
 * permitted. It always opens (QA report: a static pill read as broken); with
 * a single destination it says so instead of offering nothing.
 * Between properties the current section is kept when the user may use it
 * in the target property (Phase 9), otherwise the target's overview opens.
 */
export function WorkspaceSwitcher({
  current,
}: {
  /** The active property, or null in the organization workspace. */
  current: { id: string; code: string; name: string } | null;
}) {
  const { data: me } = useMeQuery();
  const pathname = usePathname();
  const properties = me?.properties ?? [];
  const organization = me ? canUseOrganizationWorkspace(me) : false;

  // SERENE family selector (SALESTORM's project picker): micro-label, a
  // hairline divider, then the workspace.
  const label = (
    <span className="flex min-w-0 items-center gap-2.5 whitespace-nowrap">
      <span className="hidden label-caps lg:inline">{current ? "Property" : "Workspace"}</span>
      <span aria-hidden="true" className="hidden h-4 w-px bg-border lg:block" />
      {current ? (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-xs font-medium text-fg-muted">{current.code}</span>
          <span className="hidden truncate font-semibold text-fg lg:inline">{current.name}</span>
        </span>
      ) : (
        <span className="truncate font-semibold text-fg">
          {me?.organization.name ?? "Organization"}
        </span>
      )}
    </span>
  );
  const pill =
    "h-10 rounded-md border border-border bg-surface px-2.5 text-sm shadow-card hover:bg-surface-sunken sm:px-3";

  if (!me)
    return <div className={pill + " flex min-w-0 items-center hover:bg-surface"}>{label}</div>;
  const destinations = properties.length + (organization ? 1 : 0);

  const searchable = properties.length > 6;
  const itemClass =
    "flex items-baseline gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-surface-sunken aria-[current=page]:bg-brand-subtle aria-[current=page]:font-semibold aria-[current=page]:text-brand";
  return (
    <Disclosure label={label} buttonClassName={pill}>
      {(close) => (
        <PropertyList searchable={searchable}>
          {(filter, query) => (
            <nav aria-label="Switch workspace">
              <ul className="flex flex-col">
                {organization ? (
                  <li className="mb-1 border-b border-border-subtle pb-1">
                    <Link
                      href={organizationHomeHref(me) as Route}
                      onClick={close}
                      aria-current={current === null ? "page" : undefined}
                      className={itemClass}
                    >
                      <span className="w-12 font-mono text-xs text-fg-muted">ORG</span>
                      <span>{me.organization.name}</span>
                    </Link>
                  </li>
                ) : null}
                {properties
                  .filter((p) => filter(p.code, p.name))
                  .map((p) => (
                    <li key={p.id}>
                      <Link
                        href={(current ? switchHref(me, p, pathname) : `/${p.code}`) as Route}
                        onClick={close}
                        aria-current={p.id === current?.id ? "page" : undefined}
                        className={itemClass}
                      >
                        <span className="w-12 font-mono text-xs text-fg-muted">
                          {highlight(p.code, query)}
                        </span>
                        <span>{highlight(p.name, query)}</span>
                        <span className="ms-auto ps-3 text-2xs text-fg-muted">
                          {p.currencyCode}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
              {destinations <= 1 ? (
                <p className="max-w-64 border-t border-border-subtle px-2.5 pt-2 pb-1 text-xs text-fg-muted">
                  This is the only property assigned to you. An administrator can give you access to
                  more under Organization › Users &amp; roles.
                </p>
              ) : null}
            </nav>
          )}
        </PropertyList>
      )}
    </Disclosure>
  );
}

/** Adds the family search field above the list once there are many properties. */
function PropertyList({
  searchable,
  children,
}: {
  searchable: boolean;
  children: (filter: (...texts: string[]) => boolean, query: string) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  if (!searchable) return <>{children(() => true, "")}</>;
  return (
    <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1.5">
      <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 shadow-card focus-within:border-brand">
        <Search aria-hidden="true" className="size-4 text-fg-muted" />
        <span className="sr-only">Find a property</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a property…"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted"
        />
      </label>
      {children((...texts) => !query.trim() || matches(query, ...texts), query)}
    </div>
  );
}
