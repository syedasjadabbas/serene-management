import { StatusPanel } from "@/components/ui/StatusPanel";

/** Shown while the workspace frame (session, property) loads, before the shell appears. */
export default function WorkspaceLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas">
      <StatusPanel level={1} kind="loading" title="Loading SERENE" />
    </main>
  );
}
