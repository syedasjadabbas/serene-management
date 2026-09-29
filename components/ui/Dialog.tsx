"use client";

import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { cn } from "./cn";

/**
 * Native <dialog> modal behaviour shared by Dialog and Drawer: showModal()
 * traps focus and makes the page inert, Escape closes (the caller decides
 * via onCancel), and focus returns to the opener on close — also when the
 * element is unmounted instead of closed ({open ? <X/> : null}), which is
 * how most forms use it.
 */
export function useModalDialog(open: boolean): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
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

  // Unmount: close and give focus back to the opener if it is still on the page.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
      const target = opener.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, []);

  return ref;
}

/**
 * Modal dialog for a focused command or confirmation: title, optional
 * description, scrollable body, and a footer whose primary action is last.
 * Prefer inline editing or a Drawer for long, record-centric work.
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
  const ref = useModalDialog(open);
  const titleId = useId();

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
        "opacity-100 transition-[opacity,translate] duration-200 ease-out-quart starting:translate-y-2 starting:opacity-0",
        size === "lg" ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open ? (
        <div className="flex flex-col">
          <div className="px-6 pt-5 pb-3">
            <h2 id={titleId} className="text-lg font-semibold tracking-[-0.01em]">
              {title}
            </h2>
            {description ? (
              <div className="mt-1 text-sm text-fg-secondary">{description}</div>
            ) : null}
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-6 pb-5">{children}</div>
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle bg-surface-sunken/60 px-6 py-3.5">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
