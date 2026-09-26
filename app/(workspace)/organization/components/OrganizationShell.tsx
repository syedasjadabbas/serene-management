import type { ReactNode } from "react";
import { UserMenu } from "@/components/workspace/UserMenu";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { OrganizationNav } from "./OrganizationNav";

/** Frame of the organization workspace; below lg the navigation takes its own row. */
export function OrganizationShell({ children }: { children: ReactNode }) {
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
        <WorkspaceSwitcher current={null} />
        <OrganizationNav />
        <div className="ms-auto flex min-w-0 items-center gap-3 lg:shrink-0">
          <span className="rounded-sm bg-surface-sunken px-2 py-0.5 text-xs text-fg-secondary">
            Organization
          </span>
          <UserMenu />
        </div>
      </header>
      <main id="main" className="px-4 py-6">
        {children}
      </main>
    </>
  );
}
