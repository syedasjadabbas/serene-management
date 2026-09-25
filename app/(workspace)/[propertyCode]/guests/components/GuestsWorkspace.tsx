"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { cn } from "@/components/ui/cn";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { CompaniesPanel } from "./CompaniesPanel";
import { GuestsPanel } from "./GuestsPanel";
import { LoyaltyPanel } from "./LoyaltyPanel";

/**
 * Guests, companies and loyalty (organization profiles, Phase 7). Profiles
 * are shared by every property; what a user sees of stays, balances and
 * notes is limited by their permissions at each property.
 */
export function GuestsWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabs = [
    ["guests", "Guests", can("guests:read")],
    ["companies", "Companies", can("accounts:read")],
    ["loyalty", "Loyalty", can("loyalty:read")],
  ] as const;
  const visible = tabs.filter(([, , allowed]) => allowed);
  const tab = visible.find(([id]) => id === params.get("tab"))?.[0] ?? visible[0]?.[0];

  if (isLoading) return <StatusPanel kind="loading" title="Loading guests" />;
  if (!tab) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the guests:read permission."
      />
    );
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Guests</h1>
        <p className="text-sm text-fg-muted">
          Guest and company profiles are shared by every property of the organization.
        </p>
      </div>
      <div role="tablist" aria-label="Profiles" className="flex flex-wrap gap-1">
        {visible.map(([id, label]) => (
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
      {tab === "guests" ? <GuestsPanel /> : null}
      {tab === "companies" ? <CompaniesPanel /> : null}
      {tab === "loyalty" ? <LoyaltyPanel /> : null}
    </div>
  );
}
