import { cn } from "./cn";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-border border-t-brand motion-reduce:animate-none"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
