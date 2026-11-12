import { cn } from "./cn";
import { Skeleton } from "./Skeleton";

/**
 * Loading state for a whole workspace page, rendered inside the app shell:
 * the page header, a filter strip and the content area keep their places
 * as shimmer blocks, so the layout does not jump when data arrives. The
 * title is announced once (and is the page's h1 while it loads).
 *
 * `layout="list"` (default) is a list/table page; `detail` a record page
 * with a main column and a side column.
 */
export function PageSkeleton({
  title,
  layout = "list",
  className,
}: {
  title: string;
  layout?: "list" | "detail";
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-6", className)}>
      <h1 className="sr-only">{title}</h1>
      <div
        aria-hidden="true"
        className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface px-5 py-5 shadow-card sm:flex-row sm:items-center sm:px-6"
      >
        <Skeleton className="hidden size-11 shrink-0 rounded-md sm:block" />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-56 max-w-full rounded-md" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
      </div>

      {layout === "list" ? (
        <>
          <div aria-hidden="true" className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-64 max-w-full rounded-md" />
            <Skeleton className="h-9 w-36 rounded-md" />
            <Skeleton className="h-9 w-36 rounded-md" />
          </div>
          <div
            aria-hidden="true"
            className="overflow-hidden rounded-lg border border-border-subtle bg-surface"
          >
            <div className="flex h-10 items-center gap-4 bg-surface-sunken px-3">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-2.5 flex-1" />
              <Skeleton className="h-2.5 flex-1" />
              <Skeleton className="h-2.5 w-12" />
            </div>
            <div className="divide-y divide-border-subtle">
              {[0, 1, 2, 3, 4, 5, 6].map((row) => (
                <div key={row} className="flex h-row items-center gap-4 px-3">
                  <Skeleton className="h-3 w-1/4" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div aria-hidden="true" className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-5 lg:col-span-2">
            <Skeleton className="h-4 w-40" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-2 h-24 w-full rounded-md" />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>
      )}
    </div>
  );
}
