import { cn } from "./cn";

/**
 * Shared look of form controls (TextField, Select, TextArea and the few
 * route-local inputs such as list search boxes), so every control has the
 * same height, outline, hover and invalid states. Focus uses the global
 * :focus-visible ring. The outline is border-strong (>= 3:1, WCAG 1.4.11).
 */
export const fieldLabelClass = "text-xs font-medium text-fg-secondary";
export const fieldHintClass = "text-xs text-fg-muted";
export const fieldErrorClass = "text-xs text-danger";

export function controlClass(invalid = false, className?: string) {
  return cn(
    "rounded-md border bg-surface text-sm text-fg transition-colors duration-150",
    "placeholder:text-fg-muted",
    "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-muted",
    invalid ? "border-danger" : "border-border-strong hover:border-fg-muted",
    className,
  );
}
