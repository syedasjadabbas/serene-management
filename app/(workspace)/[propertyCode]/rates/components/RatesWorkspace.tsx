"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { PackagesView } from "./PackagesView";
import { RateCalendarPanel } from "./RateCalendarPanel";
import { RatePlansView } from "./RatePlansView";
import { RestrictionsView } from "./RestrictionsView";

const TABS = [
  ["plans", "Rate plans"],
  ["calendar", "Pricing calendar"],
  ["restrictions", "Restrictions"],
  ["packages", "Packages"],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * Rate administration. Every price shown is computed by the server's
 * pricing engine (the same one bookings use); this screen only configures it.
 */
export function RatesWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = (TABS.find(([id]) => id === params.get("tab"))?.[0] ?? "plans") as Tab;

  if (isLoading) return <StatusPanel kind="loading" title="Loading rates" />;
  if (!can("rates:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the rates:read permission."
      />
    );
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Rates</h1>
        <p className="text-sm text-fg-muted">
          Rate plans, seasons, restrictions and packages in {property.currencyCode}. Bookings are
          always priced by the server from this configuration.
        </p>
      </div>
      <div role="tablist" aria-label="Rate administration" className="flex flex-wrap gap-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => router.replace(`${pathname}?tab=${id}` as Route)}
            className={cn(
              "min-h-11 rounded-md px-3 text-sm",
              tab === id
                ? "bg-brand-subtle font-medium text-brand"
                : "text-fg-secondary hover:bg-surface-sunken",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "plans" ? <RatePlansView /> : null}
      {tab === "calendar" ? <RateCalendarPanel /> : null}
      {tab === "restrictions" ? <RestrictionsView /> : null}
      {tab === "packages" ? <PackagesView /> : null}
    </div>
  );
}
