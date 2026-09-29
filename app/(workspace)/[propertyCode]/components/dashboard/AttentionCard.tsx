import { ChevronRight, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { textLinkClass } from "@/components/ui/Button";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "@/components/ui/cn";

export interface AttentionItem {
  id: string;
  tone: "danger" | "warning" | "info";
  message: string;
  href?: Route | null;
  linkLabel?: string;
}

const ICONS = { danger: CircleAlert, warning: TriangleAlert, info: Info } as const;
const TONES = {
  danger: "bg-danger-subtle text-danger",
  warning: "bg-warning-subtle text-warning",
  info: "bg-info-subtle text-info",
} as const;

/**
 * Operational alerts derived from live data (business date sync, rooms,
 * front desk and maintenance summaries). Rendered only when something needs
 * attention; most urgent first. The list is not a live region: it updates
 * with polling and would otherwise interrupt screen-reader users.
 */
export function AttentionCard({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  const order = { danger: 0, warning: 1, info: 2 };
  const sorted = [...items].sort((a, b) => order[a.tone] - order[b.tone]);
  return (
    <section
      aria-labelledby="attention-heading"
      className="rounded-lg border border-border-subtle bg-surface shadow-card"
    >
      <h2 id="attention-heading" className="px-5 pt-4 pb-2 text-lg font-semibold">
        Needs attention
      </h2>
      <ul className="divide-y divide-border-subtle">
        {sorted.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <li key={item.id} className="flex items-center gap-3 px-5 py-3">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  TONES[item.tone],
                )}
              >
                <Icon className="size-4" />
              </span>
              <p className="min-w-0 flex-1 text-sm text-fg">{item.message}</p>
              {item.href ? (
                <Link href={item.href} className={cn(textLinkClass, "shrink-0")}>
                  {item.linkLabel ?? "Open"}
                  <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
