import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "touch";

/**
 * One primary action per view or dialog; secondary for alternatives;
 * ghost for low-emphasis and toolbar actions; danger only for destructive
 * or irreversible commands (usually confirmed in a dialog).
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand font-semibold text-brand-fg shadow-[0_1px_2px_rgb(16_124_65/0.24)] hover:bg-brand-hover active:bg-brand-hover disabled:bg-border-strong disabled:text-fg-inverse disabled:shadow-none",
  secondary:
    "border border-border bg-surface font-medium text-fg shadow-card hover:bg-surface-sunken disabled:text-fg-muted disabled:hover:bg-surface",
  ghost:
    "font-medium text-fg-secondary hover:bg-surface-sunken hover:text-fg disabled:text-fg-muted disabled:hover:bg-transparent",
  danger: "bg-danger font-semibold text-fg-inverse hover:opacity-90 disabled:opacity-50",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-control-sm px-3 text-xs",
  md: "h-control px-4 text-sm",
  touch: "h-control-touch px-5 text-base",
};

export const buttonBaseClass =
  "inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap transition-colors duration-150 ease-out-quart disabled:cursor-not-allowed motion-reduce:transition-none [&_svg]:shrink-0";

/**
 * Standalone text link ("View all", "Open front desk"): brand colour, 24px
 * minimum target (WCAG 2.5.8), 40px on touch screens. Not for links inside
 * running text, which keep the line height.
 */
export const textLinkClass =
  "inline-flex min-h-6 items-center gap-0.5 text-sm font-medium text-brand hover:underline pointer-coarse:min-h-10";

/** Class string for links styled as buttons (e.g. a Link to "New reservation"). */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(buttonBaseClass, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {pending ? <Spinner label="Working" /> : null}
      {children}
    </button>
  );
});
