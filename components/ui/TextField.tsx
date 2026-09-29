import { type InputHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "./cn";
import { controlClass, fieldErrorClass, fieldHintClass, fieldLabelClass } from "./field";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  /** Validation messages; the first is shown and announced. */
  errors?: string[];
  hint?: string;
  /** `lg` (44px, 15px text) for sign-in and other single-purpose forms. */
  controlSize?: "md" | "lg";
}

/** Labelled input with hint and error wired through aria-describedby. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
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
  const error = errors?.[0];
  const describedBy = [describedByProp, hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <input
        ref={ref}
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={
          controlSize === "lg"
            ? controlClass(Boolean(error), "h-11 px-3.5", "text-[0.9375rem]")
            : controlClass(Boolean(error), "h-control px-3")
        }
      />
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
});
