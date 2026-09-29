"use client";

import { Contact } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { Tab, TabList } from "@/components/ui/TabList";
import { useTabs } from "@/components/ui/tabs";
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
  const profileTabs = [
    ["guests", "Guests", can("guests:read")],
    ["companies", "Companies", can("accounts:read")],
    ["loyalty", "Loyalty", can("loyalty:read")],
  ] as const;
  const visible = profileTabs.filter(([, , allowed]) => allowed);
  const tab = visible.find(([id]) => id === params.get("tab"))?.[0] ?? visible[0]?.[0];
  const tabs = useTabs(
    visible.map(([id]) => id),
    tab,
    (id) => router.replace(`${pathname}?tab=${id}` as Route),
  );

  if (isLoading) return <PageSkeleton title="Loading guests" />;
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
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Contact}
        breadcrumbs={[{ label: property.code, href: `/${property.code}` }, { label: "Guests" }]}
        title="Guests"
        description="Guest and company profiles are shared by every property of the organization."
      />
      <TabList label="Profiles">
        {visible.map(([id, label]) => (
          <Tab
            key={id}
            {...tabs.tab(id)}
            onClick={() => router.replace(`${pathname}?tab=${id}` as Route)}
          >
            {label}
          </Tab>
        ))}
      </TabList>
      <div {...tabs.panel}>
        {tab === "guests" ? <GuestsPanel /> : null}
        {tab === "companies" ? <CompaniesPanel /> : null}
        {tab === "loyalty" ? <LoyaltyPanel /> : null}
      </div>
    </div>
  );
}
