import { type ReactNode, Suspense } from "react";
import { AppShell } from "@/components/workspace/AppShell";
import { UserMenu } from "@/components/workspace/UserMenu";
import { BusinessDateBadge } from "./BusinessDateBadge";
import { OfflineControls } from "./OfflineControls";
import { PropertySwitcher } from "./PropertySwitcher";
import { PropertyGlobalSearch } from "./PropertyGlobalSearch";
import { PropertyRealtime } from "./PropertyRealtime";
import { WorkspaceNav } from "./WorkspaceNav";

/**
 * Property workspace frame: property context, global search, business
 * date and account in the header, live updates of the property (no UI), the property navigation under it (in the
 * drawer below lg). The navigation reads `?tab=` to mark tab destinations
 * (Companies, Loyalty, Packages), hence the Suspense boundaries.
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      nav={
        <Suspense>
          <WorkspaceNav variant="bar" />
        </Suspense>
      }
      mobileNav={
        <Suspense>
          <WorkspaceNav variant="panel" />
        </Suspense>
      }
      account={<UserMenu variant="panel" />}
      context={<PropertySwitcher />}
      search={<PropertyGlobalSearch />}
      actions={
        <>
          <PropertyRealtime />
          <OfflineControls />
          <BusinessDateBadge />
          <div className="hidden sm:block">
            <UserMenu />
          </div>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
