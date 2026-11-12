import type { Metadata } from "next";
import { PermissionGate } from "@/global/components/PermissionGate";
import { P } from "@/global/constants/api";
import { GroupDetailView } from "./_components/GroupDetailView";

export const metadata: Metadata = { title: "Group" };

export default async function GroupPage({
  params,
}: {
  params: Promise<{ propertyCode: string; groupId: string }>;
}) {
  const { groupId } = await params;
  return (
    <PermissionGate permission={P.GROUPS_READ}>
      <GroupDetailView groupId={groupId} />
    </PermissionGate>
  );
}
