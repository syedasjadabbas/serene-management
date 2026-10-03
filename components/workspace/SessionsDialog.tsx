"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { useRevokeSessionMutation, useSessionsQuery } from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";
import type { SessionView } from "@/modules/identity/identity.types";

/** A readable "Browser on system" from the user agent; the raw string is not shown. */
function describeDevice(userAgent: string | null): { label: string; mobile: boolean } {
  if (!userAgent) return { label: "Unknown device", mobile: false };
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const system = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return {
    label: system ? `${browser} on ${system}` : browser,
    mobile: /Mobi|iPhone|Android/.test(ua),
  };
}

/**
 * The signed-in user's own sessions: where they are signed in and when each
 * was last used. Signing out another session takes effect on its next
 * request; signing out this one returns to the sign-in page.
 */
export function SessionsDialog({ onClose }: { onClose: () => void }) {
  const sessions = useSessionsQuery();
  const [revoke, revokeState] = useRevokeSessionMutation();
  const router = useRouter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const error = toClientApiError(sessions.error) ?? toClientApiError(revokeState.error);

  async function signOut(session: SessionView) {
    const result = await revoke(session.id);
    if ("data" in result && result.data?.current) {
      router.replace("/login");
      router.refresh();
    }
  }

  const rows = sessions.data ?? [];
  return (
    <Dialog
      open
      onClose={onClose}
      title="Signed-in devices"
      description="Browsers and devices where your account is signed in. Sign out any you do not recognise, then change your password."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {sessions.isLoading ? (
        <Spinner label="Loading sessions" />
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {rows.map((session) => {
            const device = describeDevice(session.userAgent);
            const Icon = device.mobile ? Smartphone : Monitor;
            return (
              <li key={session.id} className="flex items-start gap-3 py-3">
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {device.label}
                    {session.current ? <Badge tone="success">This browser</Badge> : null}
                  </p>
                  <p className="text-xs text-fg-secondary">
                    Last active {formatDateTime(session.lastUsedAt, timeZone)}
                    {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                  </p>
                  <p className="text-xs text-fg-muted">
                    Signed in {formatDateTime(session.createdAt, timeZone)}
                  </p>
                </div>
                <Button
                  variant={session.current ? "ghost" : "secondary"}
                  size="sm"
                  pending={revokeState.isLoading && revokeState.originalArgs === session.id}
                  onClick={() => void signOut(session)}
                >
                  Sign out
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
