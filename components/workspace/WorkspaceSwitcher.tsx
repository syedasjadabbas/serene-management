"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { Disclosure } from "./Disclosure";
import { canUseOrganizationWorkspace, switchHref } from "./sections";

/**
 * Switches between the organization workspace and the user's properties.
 * Switching is plain navigation; the server re-authorizes the new URL.
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
      <span className="hidden label-caps md:inline">{current ? "Property" : "Workspace"}</span>
      <span aria-hidden="true" className="hidden h-4 w-px bg-border md:block" />
      {current ? (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-xs font-medium text-fg-muted">{current.code}</span>
          <span className="hidden truncate font-semibold text-fg sm:inline">{current.name}</span>
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

  if (!me || (properties.length <= 1 && !organization))
    return <div className={pill + " flex min-w-0 items-center hover:bg-surface"}>{label}</div>;

  const itemClass =
    "flex items-baseline gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-surface-sunken aria-[current=page]:bg-brand-subtle aria-[current=page]:font-semibold aria-[current=page]:text-brand";
  return (
    <Disclosure label={label} buttonClassName={pill}>
      {(close) => (
        <nav aria-label="Switch workspace">
          <ul className="flex flex-col">
            {organization ? (
              <li className="mb-1 border-b border-border-subtle pb-1">
                <Link
                  href={"/organization" as Route}
                  onClick={close}
                  aria-current={current === null ? "page" : undefined}
                  className={itemClass}
                >
                  <span className="w-12 font-mono text-xs text-fg-muted">ORG</span>
                  <span>{me.organization.name}</span>
                </Link>
              </li>
            ) : null}
            {properties.map((p) => (
              <li key={p.id}>
                <Link
                  href={(current ? switchHref(me, p, pathname) : `/${p.code}`) as Route}
                  onClick={close}
                  aria-current={p.id === current?.id ? "page" : undefined}
                  className={itemClass}
                >
                  <span className="w-12 font-mono text-xs text-fg-muted">{p.code}</span>
                  <span>{p.name}</span>
                  <span className="ms-auto ps-3 text-2xs text-fg-muted">{p.currencyCode}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </Disclosure>
  );
}
