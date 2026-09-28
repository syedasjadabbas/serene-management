"use client";

import { Button } from "@/components/ui/Button";
import { StatusPanel } from "@/components/ui/StatusPanel";

/** Errors outside the property workspace (sign-in pages, organization shell). */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <StatusPanel
        level={1}
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
    </main>
  );
}
