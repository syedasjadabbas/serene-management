import type { ReactNode } from "react";
import { BusinessDateBadge } from "./BusinessDateBadge";
import { PropertySwitcher } from "./PropertySwitcher";
import { UserMenu } from "@/components/workspace/UserMenu";
import { WorkspaceNav } from "./WorkspaceNav";

/**
 * Authenticated frame: identity, property context, business date and navigation.
 * Below lg the header wraps and the navigation takes its own scrollable row.
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-surface px-4 py-2 lg:h-12 lg:flex-nowrap lg:py-0 print:hidden">
        <span className="text-xs font-semibold tracking-[0.2em] text-brand">SERENE</span>
        <span aria-hidden="true" className="h-5 w-px bg-border-subtle" />
        <PropertySwitcher />
        <WorkspaceNav />
        <div className="ms-auto flex min-w-0 items-center gap-3 lg:shrink-0">
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
