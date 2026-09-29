"use client";

import { CloudOff, RefreshCw, TriangleAlert, Wifi } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Disclosure } from "@/components/workspace/Disclosure";
import { cn } from "@/components/ui/cn";
import { clearOfflineData } from "@/lib/offline/db";
import { snapshotKey } from "@/lib/offline/policy";
import { useConnectivity } from "@/lib/offline/useConnectivity";
import { queueCounts, useOfflineStore } from "@/lib/offline/useOfflineStore";

const FIELD =
  "inline-flex h-10 items-center gap-2 rounded-md border bg-surface px-2.5 text-xs font-medium whitespace-nowrap shadow-card transition-colors duration-150 hover:bg-surface-sunken";

const time = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });

/**
 * Header connectivity indicator (docs/OFFLINE_ARCHITECTURE.md §M). Online
 * with nothing pending it is a quiet icon; otherwise it names the state:
 * Offline mode (with the time of the last offline copy), N changes waiting,
 * Syncing…, N changes need attention. The panel explains what works
 * offline and lets the user delete the offline copy from this browser.
 */
export function ConnectivityStatus({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string | null;
}) {
  const { online, recheck } = useConnectivity();
  const store = useOfflineStore();
  const [clearing, setClearing] = useState(false);
  const snapshot = userId
    ? store.snapshots.find((s) => s.key === snapshotKey(userId, propertyId))
    : undefined;
  const counts = queueCounts(store.queue, propertyId);
  const offline = online === false;

  const state = counts.attention
    ? {
        tone: "border-danger/35 text-danger",
        icon: TriangleAlert,
        label: `${counts.attention} ${counts.attention === 1 ? "change needs" : "changes need"} attention`,
      }
    : offline
      ? { tone: "border-warning/40 text-warning", icon: CloudOff, label: "Offline mode" }
      : counts.syncing
        ? { tone: "border-info/35 text-info", icon: RefreshCw, label: "Syncing…" }
        : counts.waiting
          ? {
              tone: "border-warning/40 text-warning",
              icon: RefreshCw,
              label: `${counts.waiting} ${counts.waiting === 1 ? "change" : "changes"} waiting`,
            }
          : null;
  const Icon = state?.icon ?? Wifi;
  const lastSynced = snapshot ? `Last synced ${time(snapshot.savedAt)}` : "No offline copy yet";

  return (
    <>
      <span role="status" className="sr-only">
        {state?.label ?? ""}
      </span>
      <Disclosure
        align="end"
        buttonClassName={cn(FIELD, state?.tone ?? "border-border text-fg-muted")}
        chevronClassName="hidden"
        label={
          <>
            <Icon
              aria-hidden="true"
              className={cn("size-4 shrink-0", counts.syncing > 0 && !offline && "animate-spin")}
            />
            {state ? (
              <span className="flex flex-col items-start leading-tight">
                <span className="hidden sm:inline">{state.label}</span>
                <span className="sr-only sm:hidden">{state.label}</span>
                {offline ? (
                  <span className="hidden text-2xs font-normal text-fg-muted min-[100rem]:inline">
                    {lastSynced}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="sr-only">{online === null ? "Checking connection" : "Online"}</span>
            )}
          </>
        }
      >
        {(close) => (
          <div className="flex w-72 flex-col gap-3 p-3 text-sm">
            <div>
              <p className="font-semibold text-fg">
                {offline ? "Offline mode" : online === null ? "Checking connection…" : "Online"}
              </p>
              <p className="mt-0.5 text-xs text-fg-secondary">{lastSynced}</p>
            </div>
            <p className="text-xs text-fg-secondary">
              {offline
                ? "Changes cannot be saved until the connection returns. The offline view shows today's arrivals, departures, in-house guests and rooms as last synced, read-only."
                : "This browser keeps a read-only copy of today's front office for connection outages. Payments, charges and night audit always need a connection."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/offline"
                className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-surface-sunken"
              >
                Open offline view
              </Link>
              <button
                type="button"
                onClick={() => void recheck()}
                className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-surface-sunken"
              >
                Check connection
              </button>
            </div>
            <button
              type="button"
              disabled={clearing}
              onClick={async () => {
                setClearing(true);
                await clearOfflineData();
                setClearing(false);
                close();
              }}
              className="self-start text-xs font-medium text-danger underline-offset-2 hover:underline disabled:opacity-60"
            >
              Clear offline data from this browser
            </button>
            <p className="-mt-2 text-2xs text-fg-muted">
              Signing out always clears it. While you stay signed in, a new copy is saved on the
              next refresh.
            </p>
          </div>
        )}
      </Disclosure>
    </>
  );
}
