import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { AppShell } from "@/components/workspace/AppShell";
import { UserMenu } from "@/components/workspace/UserMenu";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { OrganizationGlobalSearch } from "./OrganizationGlobalSearch";
import { OrganizationNav } from "./OrganizationNav";

/** Organization workspace frame: workspace switcher and account in the header, cross-property navigation under it. */
export function OrganizationShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      nav={<OrganizationNav variant="bar" />}
      mobileNav={<OrganizationNav variant="panel" />}
      account={<UserMenu variant="panel" />}
      context={<WorkspaceSwitcher current={null} />}
      search={<OrganizationGlobalSearch />}
      actions={
        <>
          <Badge tone="accent" className="hidden sm:inline-flex">
            Organization
          </Badge>
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
