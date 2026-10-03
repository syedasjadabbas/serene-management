"use client";

import { SlidersHorizontal } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { Tab, TabList } from "@/components/ui/TabList";
import { useTabs } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { usePropertySetupQuery } from "@/lib/api/endpoints/setup.api";
import { toClientApiError } from "@/lib/api/errors";
import { RoomTypesView } from "./RoomTypesView";
import { RoomsView } from "./RoomsView";
import { SettingsView } from "./SettingsView";
import { SetupOverview } from "./SetupOverview";
import { TaxesView } from "./TaxesView";

const TABS = [
  ["overview", "Overview"],
  ["room-types", "Room types"],
  ["rooms", "Rooms & floors"],
  ["taxes", "Taxes"],
  ["settings", "Settings"],
] as const;
type SetupTab = (typeof TABS)[number][0];

/**
 * Property setup: the room inventory, taxes and operational settings a
 * property needs before go-live and maintains afterwards. Viewing needs
 * settings:read, changes settings:manage (each audited with a reason),
 * go-live properties:manage. The server enforces every rule.
 */
export function SetupWorkspace() {
  const property = useProperty();
  const { can, isLoading } = usePermissions(property.id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: SetupTab = (TABS.find(([id]) => id === params.get("tab"))?.[0] ??
    "overview") as SetupTab;
  const tabs = useTabs(
    TABS.map(([id]) => id),
    tab,
    (id) => router.replace(`${pathname}?tab=${id}` as Route),
  );
  const allowed = !isLoading && can("settings:read");
  const setup = usePropertySetupQuery(property.id, { skip: !allowed });
  const error = toClientApiError(setup.error);

  if (isLoading) return <PageSkeleton title="Loading property setup" />;
  if (!can("settings:read")) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="Viewing the property setup needs the settings:read permission."
      />
    );
  }
  const manage = can("settings:manage");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={SlidersHorizontal}
        breadcrumbs={[
          { label: property.code, href: `/${property.code}` },
          { label: "Property setup" },
        ]}
        title="Property setup"
        description="Room types, rooms, taxes and operating settings. Every change is recorded in the audit trail with its reason."
      />
      <TabList label="Property setup">
        {TABS.map(([id, label]) => (
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
        {tab === "settings" ? (
          <SettingsView manage={manage} live={setup.data?.readiness.live ?? false} />
        ) : setup.isLoading ? (
          <StatusPanel kind="loading" title="Loading the setup" />
        ) : error || !setup.data ? (
          <StatusPanel
            kind={error?.status === 403 ? "forbidden" : "error"}
            title={error?.status === 403 ? "Access denied" : "Could not load the setup"}
            description={error?.message}
            requestId={error?.requestId}
          />
        ) : tab === "overview" ? (
          <SetupOverview
            setup={setup.data}
            canGoLive={can("properties:manage")}
            onOpen={(id) => router.replace(`${pathname}?tab=${id}` as Route)}
          />
        ) : tab === "room-types" ? (
          <RoomTypesView setup={setup.data} manage={manage} />
        ) : tab === "rooms" ? (
          <RoomsView setup={setup.data} manage={manage} />
        ) : (
          <TaxesView setup={setup.data} manage={manage} />
        )}
      </div>
    </div>
  );
}
