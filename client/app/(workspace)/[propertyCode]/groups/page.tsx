import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/global/components/ui/PageSkeleton";
import { GroupsWorkspace } from "./_components/GroupsWorkspace";

export const metadata: Metadata = { title: "Groups" };

export default function GroupsPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading groups" />}>
      <GroupsWorkspace />
    </Suspense>
  );
}
