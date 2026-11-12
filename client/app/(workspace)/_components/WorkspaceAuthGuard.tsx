"use client";

import type { ReactNode } from "react";
import { Button } from "@/global/components/ui/Button";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { SessionLoader } from "@/global/components/session/SessionLoader";
import { useMeQuery } from "@/global/api/endpoints/sessionApi";
import { toClientApiError } from "@/global/api/errors";
import { useRequireAuth } from "@/global/hooks/useRequireAuth";

/**
 * Authenticated area, guarded on the client (the access token lives in
 * memory, so the Next.js server cannot see the session). Booting → loader;
 * anonymous → redirect to /login; authenticated → the signed-in user's
 * access (`/me`) is loaded once for every nested layout, then the page renders.
 */
export function WorkspaceAuthGuard({ children }: { children: ReactNode }) {
  const status = useRequireAuth();
  if (status !== "authenticated") {
    return (
      <SessionLoader
        {...(status === "anonymous"
          ? { title: "Redirecting to sign in", description: "Your session is not active." }
          : {})}
      />
    );
  }
  return <AccessLoader>{children}</AccessLoader>;
}

function AccessLoader({ children }: { children: ReactNode }) {
  const me = useMeQuery();
  if (me.data) return <div className="min-h-screen bg-canvas">{children}</div>;
  if (me.isError) {
    const error = toClientApiError(me.error);
    return (
      <main id="main" className="min-h-screen bg-canvas">
        <StatusPanel
          level={1}
          kind="error"
          title="Could not load your access"
          description={error?.message}
          requestId={error?.requestId}
          action={
            <Button variant="secondary" onClick={() => void me.refetch()}>
              Try again
            </Button>
          }
        />
      </main>
    );
  }
  return <SessionLoader title="Loading SERENE" description="Loading your workspace." />;
}
