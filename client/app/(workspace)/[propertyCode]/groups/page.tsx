import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { GroupsWorkspace } from "./_components/GroupsWorkspace";

export const metadata: Metadata = { title: "Groups" };

export default function GroupsPage() {
  return (
    <PermissionGate permission={P.GROUPS_READ}>
      <Suspense fallback={<PageSkeleton title="Loading groups" />}>
        <GroupsWorkspace />
      </Suspense>
    </PermissionGate>
  );
}
