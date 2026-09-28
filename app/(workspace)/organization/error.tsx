"use client";

import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";

export default function OrganizationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPanel
      level={1}
      kind="error"
      title="Something went wrong"
      description="The organization workspace could not be loaded. You can try again."
      requestId={error.digest ?? null}
      action={
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
