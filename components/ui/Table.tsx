import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Data table primitives. Tables stay tables on every screen size: the
 * frame scrolls horizontally (and is keyboard-focusable so it can be
 * scrolled without a mouse) instead of collapsing rows into cards.
 * Alignment is logical (start/end) so RTL layouts mirror correctly;
 * numbers and money are end-aligned with tabular figures.
 *
 *   <TableFrame label="Arrivals">
 *     <Table caption="Arrivals today" minWidth="44rem">
 *       <THead><tr><Th>Guest</Th><Th numeric>Balance</Th></tr></THead>
 *       <TBody><Tr><Td>…</Td><Td numeric>…</Td></Tr></TBody>
 *     </Table>
 *   </TableFrame>
 */
export function TableFrame({
  label,
  bordered = true,
  className,
  children,
}: {
  /** Names the scroll region for assistive technology. */
  label: string;
  /** false inside a Card, which already draws the border. */
  bordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "relative overflow-x-auto",
        bordered && "rounded-lg border border-border-subtle bg-surface shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Table({
  caption,
  captionHidden = true,
  minWidth,
  className,
  children,
}: {
  caption: string;
  captionHidden?: boolean;
  /** Width below which the frame scrolls instead of squeezing columns. */
  minWidth?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <table
      style={minWidth ? { minWidth } : undefined}
      className={cn("w-full border-collapse text-sm", className)}
    >
      <caption
        className={cn(
          captionHidden ? "sr-only" : "px-3 py-2 text-start text-sm font-semibold text-fg",
        )}
      >
        {caption}
      </caption>
      {children}
    </table>
  );
}

export function THead({
  sticky = false,
  className,
  children,
}: {
  sticky?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <thead
      className={cn(
        "border-b border-border-subtle bg-surface-sunken/60",
        sticky && "sticky top-0 z-(--z-sticky)",
        className,
      )}
    >
      {children}
    </thead>
  );
}

export function TBody({ className, children }: { className?: string; children: ReactNode }) {
  return <tbody className={cn("divide-y divide-border-subtle", className)}>{children}</tbody>;
}

export function Tr({
  interactive = false,
  selected = false,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        interactive && "transition-colors duration-150 hover:bg-surface-sunken/60",
        selected && "bg-brand-subtle/60",
        className,
      )}
      {...props}
    />
  );
}

export function Th({
  numeric = false,
  className,
  scope = "col",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope={scope}
      className={cn(
        "h-10 px-3 label-caps whitespace-nowrap first:ps-4 last:pe-4",
        numeric ? "text-end" : "text-start",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  numeric = false,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "h-row px-3 py-2 align-middle first:ps-4 last:pe-4",
        numeric ? "text-end tabular-nums" : "text-start",
        className,
      )}
      {...props}
    />
  );
}

/** Single full-width row for "no results" inside a table body. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-fg-secondary">
        {children}
      </td>
    </tr>
  );
}
