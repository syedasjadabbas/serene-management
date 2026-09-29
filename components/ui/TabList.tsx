import { type ComponentProps, type ReactNode, forwardRef } from "react";
import { cn } from "./cn";

/**
 * Visual tabs for `useTabs` (components/ui/tabs.ts, which owns the ARIA
 * wiring and keyboard behaviour). A white bar of text tabs (SERENE family):
 * the selected tab is a mint pill in brand green. The bar scrolls sideways
 * on narrow screens (no visible scrollbar) instead of wrapping. Use tabs
 * to switch views of one subject; use ToggleGroup to filter a list.
 *
 *   const tabs = useTabs(ids, selected, select);
 *   <TabList label="Profiles">
 *     {ids.map((id) => <Tab key={id} {...tabs.tab(id)} onClick={() => select(id)}>…</Tab>)}
 *   </TabList>
 *   <div {...tabs.panel}>…</div>
 */
export function TabList({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "scrollbar-hidden flex max-w-full gap-1 overflow-x-auto overflow-y-hidden rounded-lg border border-border-subtle bg-surface p-1 shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const Tab = forwardRef<HTMLButtonElement, ComponentProps<"button">>(function Tab(
  { className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
        "pointer-coarse:min-h-11",
        props["aria-selected"]
          ? "bg-brand-subtle font-semibold text-brand"
          : "text-fg-secondary hover:bg-surface-sunken hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
});
