import type { Metadata } from "next";
import { GroupDetailView } from "./components/GroupDetailView";

export const metadata: Metadata = { title: "Group" };

export default async function GroupPage({
  params,
}: {
  params: Promise<{ propertyCode: string; groupId: string }>;
}) {
  const { groupId } = await params;
  return <GroupDetailView groupId={groupId} />;
}
