"use client";

import { X } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "./cn";
import { useModalDialog } from "./Dialog";
import { IconButton } from "./IconButton";

/**
 * Side sheet on the native <dialog> element (same focus handling as Dialog).
 * Use it for navigation on small screens and for record details that keep
 * the list visible behind them. `side` is logical: start is left in LTR and
 * right in RTL. `tone="nav"` renders the navigation panel surface.
 */
export function Drawer({
  open,
  onClose,
  title,
  hideTitle = false,
  side = "end",
  tone = "surface",
  width = "md",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Keeps the title for assistive technology only (e.g. navigation). */
  hideTitle?: boolean;
  side?: "start" | "end";
  tone?: "surface" | "nav";
  width?: "sm" | "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useModalDialog(open);
  const titleId = useId();
  const nav = tone === "nav";

  return (
    // Backdrop clicks close the drawer as a pointer convenience; the keyboard
    // equivalent is Escape (native <dialog> cancel), so no key handler is needed.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "fixed inset-y-0 m-0 h-dvh max-h-dvh max-w-[calc(100vw-3rem)] p-0 shadow-overlay backdrop:bg-overlay",
        "transition-[translate] duration-200 ease-out-quart",
        side === "start"
          ? "start-0 me-auto starting:ltr:-translate-x-full starting:rtl:translate-x-full"
          : "end-0 ms-auto starting:ltr:translate-x-full starting:rtl:-translate-x-full",
        width === "sm" ? "w-72" : width === "lg" ? "w-[40rem]" : "w-[28rem]",
        nav ? "bg-nav text-nav-fg" : "border-border-subtle bg-surface-raised text-fg",
        !nav && (side === "start" ? "border-e" : "border-s"),
      )}
    >
      {open ? (
        <div className="flex h-full flex-col">
          <div
            className={cn(
              "flex min-h-14 items-center gap-3 px-4",
              !hideTitle && (nav ? "border-b border-nav-border" : "border-b border-border-subtle"),
            )}
          >
            <h2
              id={titleId}
              className={cn(
                "min-w-0 flex-1 truncate text-lg font-semibold",
                hideTitle && "sr-only",
              )}
            >
              {title}
            </h2>
            <IconButton
              label="Close"
              variant="ghost"
              onClick={onClose}
              className={cn(
                "ms-auto",
                nav && "text-nav-fg hover:bg-nav-raised hover:text-nav-fg-hover",
              )}
            >
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle px-4 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
