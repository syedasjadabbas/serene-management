import type { ReactNode } from "react";
import { BusinessDateBadge } from "./BusinessDateBadge";
import { PropertySwitcher } from "./PropertySwitcher";
import { UserMenu } from "./UserMenu";

/** Minimal authenticated frame for Phase 1: identity, property context, business date. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="flex h-12 items-center gap-3 border-b border-border-subtle bg-surface px-4">
        <span className="text-xs font-semibold tracking-[0.2em] text-brand">SERENE</span>
        <span aria-hidden="true" className="h-5 w-px bg-border-subtle" />
        <PropertySwitcher />
        <div className="ms-auto flex items-center gap-3">
          <BusinessDateBadge />
          <UserMenu />
        </div>
      </header>
      <main id="main" className="px-4 py-6">
        {children}
      </main>
    </>
  );
}
