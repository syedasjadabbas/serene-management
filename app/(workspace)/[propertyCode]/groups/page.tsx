import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { GroupsWorkspace } from "./components/GroupsWorkspace";

export const metadata: Metadata = { title: "Groups" };

export default function GroupsPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading groups" />}>
      <GroupsWorkspace />
    </Suspense>
  );
}
