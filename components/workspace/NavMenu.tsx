"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/components/ui/cn";
import type { NavLinkItem } from "./nav";

/** Look of a top-level item in the navigation bar (link or menu button). */
export function navItemClass(active: boolean) {
  return cn(
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap transition-colors duration-150",
    active
      ? "bg-brand-subtle font-semibold text-brand"
      : "font-medium text-fg-secondary hover:bg-surface-sunken hover:text-fg",
  );
}

/**
 * Which edge of its button a menu panel lines up with: the left edge (panel
 * extends right) when it fits there, else the right edge, else the left.
 * Decided from the space on screen, not from the item's place in the bar: a
 * role that sees only "Dashboard · Rooms" has Rooms last but near the left
 * edge, and a right-aligned panel ran off the screen (QA report, accounts 6/8).
 */
export function navMenuSide(
  anchor: { left: number; right: number },
  panelWidth: number,
  viewportWidth: number,
  gutter = 16,
): "left" | "right" {
  if (anchor.left + panelWidth <= viewportWidth - gutter) return "left";
  if (anchor.right - panelWidth >= gutter) return "right";
  return "left";
}

/**
 * A navigation domain in the top bar ("Front office ▾"): a disclosure
 * button that opens a small menu of links. It is navigation, not an ARIA
 * menu: plain links in a list, so screen readers and middle-click behave as
 * links. Opens on click, Enter or Space (never on hover only); ArrowDown
 * opens it and focuses the first link, arrows/Home/End move between links,
 * Escape closes and returns focus to the button, and it closes when focus or
 * a click leaves it and when the page changes.
 */
export function NavMenu({
  label,
  heading,
  items,
}: {
  label: string;
  heading?: string;
  items: NavLinkItem[];
}) {
  const pathname = usePathname();
  // Open only on the page it was opened on: navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"left" | "right">("left");
  const focusFirst = useRef(false);
  const active = items.some((item) => item.active);

  const links = () => [
    ...(rootRef.current?.querySelectorAll<HTMLAnchorElement>("[data-nav-link]") ?? []),
  ];

  // Before paint, so the panel never flashes on the wrong side.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!open || !root || !panel) return;
    setSide(navMenuSide(root.getBoundingClientRect(), panel.offsetWidth, window.innerWidth));
  }, [open]);

  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      links()[0]?.focus();
    }
    function onPointer(event: PointerEvent) {
      if (!root!.contains(event.target as Node)) setOpenedOn(null);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpenedOn(null);
        buttonRef.current?.focus();
        return;
      }
      const list = links();
      const index = list.indexOf(document.activeElement as HTMLAnchorElement);
      if (index === -1) return; // arrows on the button are handled there
      let next: number | null = null;
      if (event.key === "ArrowDown") next = (index + 1) % list.length;
      else if (event.key === "ArrowUp") next = (index - 1 + list.length) % list.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      if (next !== null) {
        event.preventDefault();
        list[next]?.focus();
      }
    }
    function onFocusOut(event: FocusEvent) {
      if (!root!.contains(event.relatedTarget as Node | null)) setOpenedOn(null);
    }
    document.addEventListener("pointerdown", onPointer);
    root.addEventListener("keydown", onKey);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    // A keyboard "click" (Enter/Space) has detail 0: move focus into the menu.
    focusFirst.current = event.detail === 0;
    setOpenedOn(open ? null : pathname);
  }

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusFirst.current = true;
      if (open) links()[0]?.focus();
      else setOpenedOn(pathname);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        onKeyDown={onButtonKey}
        className={navItemClass(active)}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
            active ? "text-brand" : "text-fg-muted",
          )}
        />
      </button>
      <div
        ref={panelRef}
        id={id}
        hidden={!open}
        className={cn(
          "absolute top-full z-(--z-popover) mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border-subtle bg-surface-raised p-2 shadow-overlay",
          "transition-[opacity,translate] duration-150 ease-out-quart motion-reduce:transition-none starting:-translate-y-1 starting:opacity-0",
          side === "right" ? "right-0" : "left-0",
        )}
      >
        {heading ? <p className="px-2.5 pt-1 pb-2 label-caps">{heading}</p> : null}
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                data-nav-link
                href={item.href as Route}
                onClick={() => setOpenedOn(null)}
                aria-current={item.active ? "page" : undefined}
                className={cn(
                  "group flex items-start gap-3 rounded-md px-2.5 py-2 transition-colors duration-150",
                  item.active ? "bg-brand-subtle" : "hover:bg-surface-sunken",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
                    item.active
                      ? "border-brand/20 bg-surface text-brand"
                      : "border-border-subtle bg-surface-sunken text-fg-secondary group-hover:bg-surface",
                  )}
                >
                  <item.icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "text-sm",
                      item.active ? "font-semibold text-brand" : "font-medium text-fg",
                    )}
                  >
                    {item.label}
                  </span>
                  {item.description ? (
                    <span className="text-xs text-fg-muted">{item.description}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
