import { StatusPanel } from "@/components/ui/StatusPanel";

export default function Loading() {
  return <StatusPanel level={1} kind="loading" title="Loading workspace" />;
}
