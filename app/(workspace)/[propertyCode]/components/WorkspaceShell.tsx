import { type ReactNode, Suspense } from "react";
import { AppShell } from "@/components/workspace/AppShell";
import { UserMenu } from "@/components/workspace/UserMenu";
import { BusinessDateBadge } from "./BusinessDateBadge";
import { PropertySwitcher } from "./PropertySwitcher";
import { ReservationQuickSearch } from "./ReservationQuickSearch";
import { WorkspaceNav } from "./WorkspaceNav";

/**
 * Property workspace frame: property context, reservation search, business
 * date and account in the header, the property navigation under it (in the
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
      search={<ReservationQuickSearch />}
      actions={
        <>
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
