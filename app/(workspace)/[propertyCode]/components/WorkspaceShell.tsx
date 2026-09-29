import type { ReactNode } from "react";
import { AppShell } from "@/components/workspace/AppShell";
import { UserMenu } from "@/components/workspace/UserMenu";
import { BusinessDateBadge } from "./BusinessDateBadge";
import { PropertySwitcher } from "./PropertySwitcher";
import { ReservationQuickSearch } from "./ReservationQuickSearch";
import { WorkspaceNav } from "./WorkspaceNav";

/** Property workspace frame: navigation, property context, business date and account. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      nav={<WorkspaceNav />}
      context={<PropertySwitcher />}
      search={<ReservationQuickSearch />}
      actions={
        <>
          <BusinessDateBadge />
          <UserMenu />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
