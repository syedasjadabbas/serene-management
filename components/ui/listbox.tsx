"use client";

import { Check, type LucideIcon } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "./cn";

/*
 * The SERENE list interaction core, shared by SearchableSelect (every
 * dropdown) and GlobalSearch (the command palette): option rows, group
 * headings, match highlighting, keyboard movement over options and
 * top-layer positioning. One look, one set of keys everywhere.
 */

/** Wraps the first case-insensitive occurrence of `query` in a brand mark. */
export function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (q.length === 0) return text;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-[3px] bg-brand-subtle px-px font-semibold text-brand">
        {text.slice(index, index + q.length)}
      </mark>
      {text.slice(index + q.length)}
    </>
  );
}

/** True when every word of `query` appears in one of the texts. */
export { matches } from "@/lib/utils/text-match";

/**
 * Active-option state and keys for a list of `count` options: ArrowDown /
 * ArrowUp move (wrapping, skipping disabled), Home / End jump (unless the
 * key belongs to a text field), Enter chooses. `onKey` returns true when it
 * handled the key. The active option is scrolled into view.
 */
export function useActiveOption({
  count,
  isDisabled,
  onChoose,
  optionId,
}: {
  count: number;
  isDisabled?: (index: number) => boolean;
  onChoose: (index: number) => void;
  optionId: (index: number) => string;
}) {
  const [active, setActive] = useState(-1);
  const current = active >= count ? count - 1 : active;

  const step = useCallback(
    (from: number, direction: 1 | -1) => {
      if (count === 0) return -1;
      let next = from;
      for (let i = 0; i < count; i++) {
        next = (next + direction + count) % count;
        if (!isDisabled?.(next)) return next;
      }
      return -1;
    },
    [count, isDisabled],
  );

  useEffect(() => {
    if (current < 0) return;
    document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  }, [current, optionId]);

  function onKey(key: string, inTextField: boolean): boolean {
    if (key === "ArrowDown") setActive(step(current < 0 ? -1 : current, 1));
    else if (key === "ArrowUp") setActive(step(current < 0 ? 0 : current, -1));
    else if (key === "Home" && !inTextField) setActive(step(-1, 1));
    else if (key === "End" && !inTextField) setActive(step(0, -1));
    else if (key === "Enter") {
      if (current >= 0 && !isDisabled?.(current)) onChoose(current);
    } else return false;
    return true;
  }

  return { active: current, setActive, onKey };
}

/** Uppercase micro-label above a group of options. */
export function OptionGroupHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div
      id={id}
      role="presentation"
      className="sticky top-0 z-[1] bg-surface-raised px-2.5 pt-2.5 pb-1 label-caps"
    >
      {children}
    </div>
  );
}

/**
 * One option row: optional icon tile, label (with highlighted match),
 * one line of description, a trailing note, and a check when selected.
 * Rows are 40px, 44px on touch screens.
 */
export function OptionRow({
  id,
  label,
  description,
  trailing,
  icon: Icon,
  selected = false,
  active = false,
  disabled = false,
  onChoose,
  onHover,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  icon?: LucideIcon;
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  onChoose: () => void;
  onHover: () => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      onPointerMove={disabled ? undefined : onHover}
      onPointerDown={(event) => event.preventDefault()}
      onClick={disabled ? undefined : onChoose}
      // Options are never focused (the list moves an active descendant);
      // this mirrors the click for completeness.
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) onChoose();
      }}
      className={cn(
        "flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm pointer-coarse:min-h-11",
        active && "bg-surface-sunken",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md border",
            selected
              ? "border-brand/20 bg-brand-subtle text-brand"
              : "border-border-subtle bg-surface text-fg-secondary",
          )}
        >
          <Icon className="size-4" />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "break-words",
            selected ? "font-semibold text-brand" : "font-medium text-fg",
          )}
        >
          {label}
        </span>
        {description ? (
          <span className="text-xs break-words text-fg-muted">{description}</span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0 text-xs text-fg-muted">{trailing}</span> : null}
      {selected ? <Check aria-hidden="true" className="size-4 shrink-0 text-brand" /> : null}
    </li>
  );
}

/**
 * Fixed-position style of a top-layer popup anchored to `anchor`: below it,
 * or above when there is more room there, clamped inside the viewport.
 *
 * All four offsets every time, never the `inset` shorthand: the popover UA
 * style is `inset: 0`, and mixing the shorthand with a top/bottom that flips
 * between renders let React drop the offset that mattered, so the panel
 * jumped to the top-left of the viewport (QA report, Housekeeping floor filter).
 */
export function anchoredPopoverStyle(
  anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  { minWidth = 224, maxHeight = 320 }: { minWidth?: number; maxHeight?: number } = {},
): CSSProperties {
  const gutter = 8;
  const width = Math.min(Math.max(anchor.width, minWidth), viewport.width - gutter * 2);
  const left = Math.min(Math.max(anchor.left, gutter), viewport.width - width - gutter);
  const below = viewport.height - anchor.bottom - gutter;
  const above = anchor.top - gutter;
  const openBelow = below >= Math.min(maxHeight, 240) || below >= above;
  const room = Math.max(160, (openBelow ? below : above) - 4);
  return {
    position: "fixed",
    margin: 0,
    left,
    right: "auto",
    top: openBelow ? anchor.bottom + 4 : "auto",
    bottom: openBelow ? "auto" : viewport.height - anchor.top + 4,
    width,
    maxHeight: Math.min(maxHeight + 64, room),
  };
}

/**
 * Places a popup in the browser's top layer (Popover API), anchored to
 * `anchorRef`: below it, or above when there is more room there, clamped
 * inside the viewport and never clipped by scrolling containers or covered
 * by an open modal dialog. Follows the anchor while the page scrolls.
 */
export function useAnchoredPopover(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  { minWidth = 224, maxHeight = 320 }: { minWidth?: number; maxHeight?: number } = {},
) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    setStyle(
      anchoredPopoverStyle(
        anchor.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        { minWidth, maxHeight },
      ),
    );
  }, [anchorRef, minWidth, maxHeight]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    if (open) {
      place();
      if (!popover.matches(":popover-open")) popover.showPopover();
    } else if (popover.matches(":popover-open")) {
      popover.hidePopover();
    }
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  return { popoverRef, style };
}

/**
 * Surface of every dropdown panel (white, hairline, soft overlay shadow).
 * Hidden unless open: an author `display` would otherwise override the
 * browser's rule that hides closed popovers.
 */
export const popoverPanelClass =
  "hidden flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-raised p-0 text-fg shadow-overlay open:flex";
