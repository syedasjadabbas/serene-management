import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { AppShell } from "@/components/workspace/AppShell";
import { UserMenu } from "@/components/workspace/UserMenu";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { OrganizationNav } from "./OrganizationNav";

/** Organization workspace frame: cross-property navigation and account. */
export function OrganizationShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      nav={<OrganizationNav />}
      context={<WorkspaceSwitcher current={null} />}
      actions={
        <>
          <Badge tone="accent" className="hidden sm:inline-flex">
            Organization
          </Badge>
          <UserMenu />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
