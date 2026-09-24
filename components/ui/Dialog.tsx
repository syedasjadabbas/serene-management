"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "./cn";

/**
 * Modal dialog on the native <dialog> element: focus is trapped and Escape
 * closes it (browser behaviour); focus returns to the opener on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      if (opener.current instanceof HTMLElement) opener.current.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-lg border border-border-subtle bg-surface-raised p-0 text-fg shadow-overlay backdrop:bg-overlay",
        size === "lg" ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open ? (
        <div className="flex flex-col">
          <div className="border-b border-border-subtle px-5 py-3">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description ? (
              <div className="mt-0.5 text-sm text-fg-secondary">{description}</div>
            ) : null}
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
