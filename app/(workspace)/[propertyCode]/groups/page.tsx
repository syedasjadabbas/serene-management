import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { GroupsWorkspace } from "./components/GroupsWorkspace";

export const metadata: Metadata = { title: "Groups" };

export default function GroupsPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading groups" />}>
      <GroupsWorkspace />
    </Suspense>
  );
}
