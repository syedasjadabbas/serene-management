"use client";

import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, forwardRef, useId, useState } from "react";
import { cn } from "./cn";
import { controlClass, fieldErrorClass, fieldHintClass, fieldLabelClass } from "./field";

export interface PasswordFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> {
  label: string;
  errors?: string[];
  hint?: string;
  /** `lg` (44px, 15px text) for sign-in and other single-purpose forms. */
  controlSize?: "md" | "lg";
}

/**
 * Password input with a Show/Hide toggle (a real button inside the field,
 * `aria-pressed`, labelled for screen readers). Label, hint and error are
 * wired like TextField. Showing the password only changes the input type;
 * nothing is stored or sent differently.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(
    {
      label,
      errors,
      hint,
      controlSize = "md",
      className,
      "aria-describedby": describedByProp,
      ...props
    },
    ref,
  ) {
    const id = useId();
    const [visible, setVisible] = useState(false);
    const error = errors?.[0];
    const describedBy = [describedByProp, hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ");
    const lg = controlSize === "lg";
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <label htmlFor={id} className={fieldLabelClass}>
          {label}
        </label>
        <div className="relative">
          <input
            ref={ref}
            {...props}
            id={id}
            type={visible ? "text" : "password"}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            className={
              lg
                ? controlClass(Boolean(error), "h-11 w-full ps-3.5 pe-20", "text-[0.9375rem]")
                : controlClass(Boolean(error), "h-control w-full ps-3 pe-18")
            }
          />
          <button
            type="button"
            aria-pressed={visible}
            aria-controls={id}
            onClick={() => setVisible((value) => !value)}
            className="absolute inset-y-1 end-1 inline-flex items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-semibold text-fg-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-fg"
          >
            {visible ? (
              <EyeOff aria-hidden="true" className="size-3.5" />
            ) : (
              <Eye aria-hidden="true" className="size-3.5" />
            )}
            {visible ? "Hide" : "Show"}
            <span className="sr-only"> password</span>
          </button>
        </div>
        {hint ? (
          <p id={`${id}-hint`} className={fieldHintClass}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={`${id}-error`} className={fieldErrorClass}>
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
