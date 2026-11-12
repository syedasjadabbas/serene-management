import { type ButtonHTMLAttributes, forwardRef } from "react";
import { type ButtonVariant, buttonBaseClass } from "./Button";
import { cn } from "./cn";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg hover:bg-brand-hover",
  secondary:
    "border border-border bg-surface text-fg-secondary shadow-card hover:bg-surface-sunken hover:text-fg",
  ghost: "text-fg-secondary hover:bg-surface-sunken hover:text-fg",
  danger: "text-danger hover:bg-danger-subtle",
};

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> {
  /** Accessible name; also shown as the tooltip. Required: the button has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

/**
 * Square button carrying only an icon (pass a lucide icon with aria-hidden).
 * md is the control height; sm is 28px (>= 24px target, WCAG 2.5.8) and
 * grows on touch screens.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", className, type = "button", title, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cn(
        buttonBaseClass,
        "disabled:opacity-50",
        VARIANTS[variant],
        size === "sm" ? "size-control-sm" : "size-control",
        className,
      )}
      {...props}
    />
  );
});
