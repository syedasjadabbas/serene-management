import { cn } from "./cn";

/** Placeholder block with a slow shimmer (static under reduced motion). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("h-4 skeleton rounded-sm", className)} />;
}

/**
 * Loading state for a table or list: keeps the layout of the rows that are
 * coming so the page does not jump. Announces `label` once.
 */
export function SkeletonRows({
  rows = 6,
  columns = 4,
  label = "Loading",
  className,
}: {
  rows?: number;
  columns?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" className={cn("divide-y divide-border-subtle", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex h-row items-center gap-4 px-3">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              className={cn(
                "h-3",
                column === 0 ? "w-1/4" : column === columns - 1 ? "w-12" : "flex-1",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
