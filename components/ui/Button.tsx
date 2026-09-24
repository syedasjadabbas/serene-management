import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "touch";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-brand-fg hover:bg-brand-hover disabled:bg-border-strong",
  secondary:
    "border border-border bg-surface text-fg hover:bg-surface-sunken disabled:text-fg-muted",
  ghost: "text-fg-secondary hover:bg-surface-sunken hover:text-fg disabled:text-fg-muted",
  danger: "bg-danger text-fg-inverse hover:opacity-90 disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-control px-3 text-sm",
  touch: "h-control-touch px-4 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button while an action runs. */
  pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    pending = false,
    disabled,
    className,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors",
        "disabled:cursor-not-allowed motion-reduce:transition-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {pending ? <Spinner label="Working" /> : null}
      {children}
    </button>
  );
});
