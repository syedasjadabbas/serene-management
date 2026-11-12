import { Search } from "lucide-react";
import { type InputHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "./cn";
import { controlClass, fieldHintClass, fieldLabelClass } from "./field";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> {
  label: string;
  /** Keep the label for assistive technology only (the placeholder explains the field). */
  hideLabel?: boolean;
  hint?: string;
}

/** Search field with a leading magnifier; same control look as TextField. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { label, hideLabel = false, hint, className, "aria-describedby": describedByProp, ...props },
  ref,
) {
  const id = useId();
  const describedBy = [describedByProp, hint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : fieldLabelClass}>
        {label}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
        />
        <input
          ref={ref}
          {...props}
          id={id}
          type="search"
          aria-describedby={describedBy || undefined}
          className={controlClass(false, "h-control w-full ps-9 pe-3")}
        />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
