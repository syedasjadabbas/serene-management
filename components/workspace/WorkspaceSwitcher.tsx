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

  const label = current ? (
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-xs text-fg-muted">{current.code}</span>
      <span className="font-medium">{current.name}</span>
    </span>
  ) : (
    <span className="font-medium">{me?.organization.name ?? "Organization"}</span>
  );

  if (!me || (properties.length <= 1 && !organization))
    return <div className="flex h-8 items-center px-2 text-sm">{label}</div>;

  const itemClass =
    "flex items-baseline gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-sunken aria-[current=page]:bg-brand-subtle md:py-1.5";
  return (
    <Disclosure label={label}>
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
