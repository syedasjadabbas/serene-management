"use client";

import Link from "next/link";
import type { Route } from "next";
import { useProperty } from "@/hooks/useProperty";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import { Disclosure } from "./Disclosure";

/** Switching property is plain navigation to /[code]; the server re-authorizes the new URL. */
export function PropertySwitcher() {
  const property = useProperty();
  const { data: me } = useMeQuery();
  const properties = me?.properties ?? [];

  const label = (
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-xs text-fg-muted">{property.code}</span>
      <span className="font-medium">{property.name}</span>
    </span>
  );

  if (properties.length <= 1)
    return <div className="flex h-8 items-center px-2 text-sm">{label}</div>;

  return (
    <Disclosure label={label}>
      {(close) => (
        <nav aria-label="Switch property">
          <ul className="flex flex-col">
            {properties.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/${p.code}` as Route}
                  onClick={close}
                  aria-current={p.id === property.id ? "page" : undefined}
                  className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-sunken aria-[current=page]:bg-brand-subtle"
                >
                  <span className="w-12 font-mono text-xs text-fg-muted">{p.code}</span>
                  <span>{p.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </Disclosure>
  );
}
