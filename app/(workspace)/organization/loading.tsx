import { StatusPanel } from "@/components/ui/StatusPanel";

export default function OrganizationLoading() {
  return <StatusPanel level={1} kind="loading" title="Loading organization" />;
}
