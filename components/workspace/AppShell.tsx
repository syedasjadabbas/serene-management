"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/IconButton";
import { SereneLogo, SereneMark } from "@/components/brand/Logo";
import { cn } from "@/components/ui/cn";
import { RailCollapsedContext, setRailCollapsed, useRailCollapsedPreference } from "./rail";

/**
 * Authenticated frame shared by the property and organization workspaces
 * (docs/NGINAP_UI_MAPPING.md §2).
 *
 *   lg and up:  fixed light rail (wordmark + grouped navigation), which the
 *               user can collapse to icons only (remembered per browser)
 *               | 64px top bar (context · search · status · account) + content
 *   below lg:   top bar with a menu button; navigation opens in a drawer
 *
 * `context` is the workspace switcher, `search` an optional search control,
 * `actions` the status and account controls. The navigation element renders
 * in the rail and, only while open, in the drawer.
 */
export function AppShell({
  nav,
  context,
  search,
  actions,
  children,
}: {
  nav: ReactNode;
  context: ReactNode;
  search?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // The drawer belongs to the page it was opened on: navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const menuOpen = openedOn === pathname;
  const collapsed = useRailCollapsedPreference();

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-(--z-skip) focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-overlay"
      >
        Skip to content
      </a>

      <aside
        id="app-rail"
        className={cn(
          "fixed inset-y-0 start-0 z-(--z-rail) hidden flex-col border-e border-nav-border bg-nav text-nav-fg lg:flex print:hidden",
          "transition-[width] duration-200 ease-out-quart motion-reduce:transition-none",
          collapsed ? "w-rail-collapsed" : "w-rail",
        )}
      >
        <div
          className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center" : "px-5")}
        >
          {collapsed ? <SereneMark className="size-9" title="SERENE MANAGEMENT" /> : <SereneLogo />}
        </div>
        <div
          className={cn(
            "flex-1 [scrollbar-width:thin] overflow-x-hidden overflow-y-auto pt-2 pb-4",
            collapsed ? "px-2" : "px-3",
          )}
        >
          <RailCollapsedContext.Provider value={collapsed}>{nav}</RailCollapsedContext.Provider>
        </div>
        <div
          className={cn("shrink-0 border-t border-nav-border py-2", collapsed ? "px-2" : "px-3")}
        >
          <button
            type="button"
            aria-controls="app-rail"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setRailCollapsed(!collapsed)}
            className={cn(
              "flex h-10 w-full items-center gap-3 rounded-md text-sm text-nav-fg transition-colors duration-150 hover:bg-nav-raised hover:text-nav-fg-hover",
              collapsed ? "justify-center" : "px-3",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen
                aria-hidden="true"
                className="size-[1.125rem] shrink-0 rtl:-scale-x-100"
              />
            ) : (
              <PanelLeftClose
                aria-hidden="true"
                className="size-[1.125rem] shrink-0 rtl:-scale-x-100"
              />
            )}
            {collapsed ? null : <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-200 ease-out-quart motion-reduce:transition-none print:ps-0",
          collapsed ? "lg:ps-rail-collapsed" : "lg:ps-rail",
        )}
      >
        <header className="sticky top-0 z-(--z-sticky) flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-2 sm:gap-3 sm:px-4 lg:px-8 print:hidden">
          <IconButton
            label="Open navigation"
            aria-expanded={menuOpen}
            onClick={() => setOpenedOn(pathname)}
            className="lg:hidden"
          >
            <Menu aria-hidden="true" className="size-5" />
          </IconButton>
          <div className="flex min-w-0 shrink items-center overflow-hidden p-0.5 md:max-w-72">
            {context}
          </div>
          <div className="flex min-w-0 flex-1 justify-end xl:justify-center">{search}</div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">{actions}</div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>

      <Drawer
        open={menuOpen}
        onClose={() => setOpenedOn(null)}
        title="Navigation"
        hideTitle
        side="start"
        tone="nav"
        width="sm"
      >
        <div className="flex flex-col gap-5 px-3 pb-6">
          <div className="px-2">
            <SereneLogo />
          </div>
          {nav}
        </div>
      </Drawer>
    </>
  );
}
