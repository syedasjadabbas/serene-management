"use client";

import type { ReactNode } from "react";
import type { ClientApiError } from "@/lib/api/errors";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

/**
 * A command dialog: server error on top (409 conflicts as warnings), the
 * form fields, and Close / submit in the footer. Enter submits the form.
 */
export function FormDialog({
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  disabled,
  pending,
  error,
  danger,
  size,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
  pending: boolean;
  error: ClientApiError | null;
  danger?: boolean;
  size?: "md" | "lg";
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            pending={pending}
            disabled={disabled}
            onClick={onSubmit}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !pending) onSubmit();
        }}
      >
        {error ? (
          <Alert tone={error.status === 409 ? "warning" : "danger"}>{error.message}</Alert>
        ) : null}
        {children}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Mon=1 … Sun=64 weekday mask as seven toggle buttons. */
export function WeekdayPicker({
  value,
  onChange,
  label = "Days of week",
}: {
  value: number;
  onChange: (mask: number) => void;
  label?: string;
}) {
  const days = [
    ["Mon", 1],
    ["Tue", 2],
    ["Wed", 4],
    ["Thu", 8],
    ["Fri", 16],
    ["Sat", 32],
    ["Sun", 64],
  ] as const;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium text-fg-secondary">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {days.map(([name, bit]) => {
          const on = (value & bit) !== 0;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value & ~bit : value | bit)}
              className={
                on
                  ? "min-h-11 min-w-11 rounded-md border border-brand bg-brand-subtle px-2 text-xs font-medium text-brand"
                  : "min-h-11 min-w-11 rounded-md border border-border px-2 text-xs text-fg-secondary"
              }
            >
              {name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
