"use client";

import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPanel
      kind="error"
      title="Something went wrong"
      description="The page could not be loaded. You can try again."
      requestId={error.digest ?? null}
      action={
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
