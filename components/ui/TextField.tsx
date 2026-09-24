import { type InputHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "./cn";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  /** Validation messages; the first is shown and announced. */
  errors?: string[];
  hint?: string;
}

/** Labelled input with hint and error wired through aria-describedby. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, errors, hint, className, ...props },
  ref,
) {
  const id = useId();
  const error = errors?.[0];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          "h-control rounded-md border bg-surface px-2.5 text-sm text-fg placeholder:text-fg-muted",
          error ? "border-danger" : "border-border hover:border-border-strong",
        )}
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
