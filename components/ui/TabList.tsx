import { type ComponentProps, type ReactNode, forwardRef } from "react";
import { cn } from "./cn";

/**
 * Visual tabs for `useTabs` (components/ui/tabs.ts, which owns the ARIA
 * wiring and keyboard behaviour). Underlined text tabs on a hairline; the
 * list scrolls horizontally on narrow screens instead of wrapping. Use tabs
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
        "flex max-w-full gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--sm-border-subtle)]",
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
        "inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-150",
        "pointer-coarse:min-h-11",
        props["aria-selected"]
          ? "border-brand font-medium text-fg"
          : "border-transparent text-fg-secondary hover:border-border-strong hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
});
