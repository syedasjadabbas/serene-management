import { type SelectHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "./cn";
import { controlClass, fieldErrorClass, fieldHintClass, fieldLabelClass } from "./field";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  options: readonly SelectOption[];
  placeholder?: string;
  errors?: string[];
  hint?: string;
}

/** Native select (keyboard and screen-reader friendly) with label, hint and error. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    placeholder,
    errors,
    hint,
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
      <select
        ref={ref}
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={controlClass(Boolean(error), "h-control px-2.5")}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
