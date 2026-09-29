"use client";

import { ChevronDown } from "lucide-react";
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
  chevronClassName,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  buttonClassName?: string;
  chevronClassName?: string;
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
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex max-w-full min-w-0 items-center gap-1.5 text-sm transition-colors duration-150",
          // A custom look replaces the default one (cn does not merge conflicts).
          buttonClassName ?? "h-control rounded-md px-2 hover:bg-surface-sunken",
        )}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 text-fg-muted", chevronClassName)}
        />
      </button>
      {open ? (
        <div
          id={id}
          className={cn(
            "absolute top-full z-(--z-popover) mt-2 max-h-[70vh] min-w-56 overflow-y-auto rounded-lg border border-border-subtle bg-surface-raised p-1.5 shadow-overlay",
            align === "end" ? "end-0" : "start-0",
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
