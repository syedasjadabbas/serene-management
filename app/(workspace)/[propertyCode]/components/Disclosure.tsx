"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Button + popover panel for the header menus. Keyboard: Enter/Space opens,
 * Escape closes and returns focus, clicking outside closes.
 */
export function Disclosure({
  label,
  children,
  align = "start",
  buttonClassName,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-surface-sunken",
          buttonClassName,
        )}
      >
        {label}
        <span aria-hidden="true" className="text-2xs text-fg-muted">
          ▾
        </span>
      </button>
      {open ? (
        <div
          id={id}
          className={cn(
            "absolute top-full z-40 mt-1 min-w-56 rounded-lg border border-border-subtle bg-surface-raised p-1 shadow-overlay",
            align === "end" ? "end-0" : "start-0",
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
