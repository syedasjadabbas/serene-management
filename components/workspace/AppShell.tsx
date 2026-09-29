"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/IconButton";
import { SereneLogo, SereneMark } from "@/components/brand/Logo";
import { NavigationProgress } from "./NavigationProgress";

/** Shared horizontal frame of the header rows and the page content. */
const FRAME = "mx-auto w-full max-w-[1600px] px-3 sm:px-6 lg:px-8";

/**
 * Authenticated frame shared by the property and organization workspaces
 * (docs/DESIGN_SYSTEM.md §8). Top navigation, no sidebar:
 *
 *   header (sticky, white, hairline):
 *     lg and up:  logo · workspace selector · search · status · account
 *                 primary navigation row (links and domain menus)
 *     below lg:   menu · logo · workspace selector · search · status
 *                 (account from sm); navigation, and on phones the account,
 *                 open in a drawer
 *   content: capped at 1600px, centred, the same gutters as the header.
 *
 * `nav` is the navigation bar, `mobileNav` its drawer form, `account` the
 * account panel for the drawer on phones, `context` the workspace switcher,
 * `search` an optional search control and `actions` the status and account
 * controls. On every route change the page starts at its header (browser
 * back and forward keep their restored position).
 */
export function AppShell({
  nav,
  mobileNav,
  account,
  context,
  search,
  actions,
  children,
}: {
  nav: ReactNode;
  mobileNav: ReactNode;
  account?: ReactNode;
  context: ReactNode;
  search?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // The drawer belongs to the page it was opened on: navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const menuOpen = openedOn === pathname;
  const historyNavigation = useRef(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  // The workspace home: a property's dashboard or the organization overview.
  const home = `/${pathname.split("/")[1] ?? ""}`;

  useEffect(() => {
    const onPopState = () => {
      historyNavigation.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // Next keeps the scroll position when the new page's top is already in
    // view; a workspace page should always open at its header instead.
    if (historyNavigation.current) historyNavigation.current = false;
    else window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  useEffect(() => {
    // Following a link in the drawer closes it, also for a tab of the
    // current page (same pathname, so the openedOn rule does not apply).
    const panel = drawerRef.current;
    if (!menuOpen || !panel) return;
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element).closest("a[href]")) setOpenedOn(null);
    };
    panel.addEventListener("click", onClick);
    return () => panel.removeEventListener("click", onClick);
  }, [menuOpen]);

  return (
    <>
      <NavigationProgress />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-(--z-skip) focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-overlay"
      >
        Skip to content
      </a>

      <div className="flex min-h-screen flex-col">
        <div className="sticky top-0 z-(--z-sticky) border-b border-border-subtle bg-surface print:hidden">
          <header className={`${FRAME} flex h-16 items-center gap-1.5 sm:gap-3`}>
            <IconButton
              label="Open navigation"
              variant="secondary"
              aria-expanded={menuOpen}
              onClick={() => setOpenedOn(pathname)}
              className="shrink-0 lg:hidden"
            >
              <Menu aria-hidden="true" className="size-5" />
            </IconButton>
            <Link
              href={home as Route}
              aria-label="SERENE MANAGEMENT home"
              className="flex shrink-0 items-center rounded-md"
            >
              <SereneMark className="size-8 sm:hidden" />
              <span className="hidden sm:block">
                <SereneLogo size="sm" />
              </span>
            </Link>
            <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-border md:block" />
            <div className="flex min-w-0 shrink items-center md:max-w-80">{context}</div>
            <div className="flex min-w-10 flex-1 justify-end">{search}</div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">{actions}</div>
          </header>
          <div className="hidden border-t border-border-subtle lg:block">
            <div className={`${FRAME} flex h-12 items-center`}>{nav}</div>
          </div>
        </div>

        <main id="main" className={`${FRAME} flex-1 py-5 sm:py-6 lg:py-8`}>
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
        <div ref={drawerRef} className="flex flex-col gap-5 px-3 pb-6">
          <div className="px-2">
            <SereneLogo />
          </div>
          {mobileNav}
          {account ? (
            <div className="border-t border-border-subtle pt-4 sm:hidden">{account}</div>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
