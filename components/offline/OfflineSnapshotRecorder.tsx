"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { useProperty } from "@/hooks/useProperty";
import { frontDeskApi } from "@/lib/api/endpoints/front-desk.api";
import { roomsApi } from "@/lib/api/endpoints/rooms.api";
import { useMeQuery } from "@/lib/api/endpoints/session.api";
import type { AppDispatch } from "@/lib/api/store";
import {
  claimSession,
  deleteSnapshots,
  listSnapshots,
  reconcileSnapshots,
  saveSnapshot,
} from "@/lib/offline/db";
import {
  SNAPSHOT_LIST_LIMIT,
  SNAPSHOT_REFRESH_MS,
  SNAPSHOT_SECTIONS,
  type OfflineSnapshot,
  minimiseArrival,
  minimiseRoom,
  minimiseStay,
  snapshotKey,
  snapshotPermissions,
} from "@/lib/offline/policy";

/**
 * Keeps this property's offline snapshot current while the workspace is
 * online and visible (docs/OFFLINE_ARCHITECTURE.md §D): on open, then every
 * SNAPSHOT_REFRESH_MS. It first reconciles the store with the live session
 * (other users, lost properties, revoked permissions are deleted), and only
 * fetches the sections the user may read. Renders nothing.
 */
export function OfflineSnapshotRecorder() {
  const property = useProperty();
  const dispatch = useDispatch<AppDispatch>();
  const { data: me } = useMeQuery();

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    const access = me.properties.find((p) => p.id === property.id);
    const permissions = snapshotPermissions(me.user.isSuperAdmin, access?.permissions ?? []);
    const key = snapshotKey(me.user.id, property.id);

    async function record() {
      if (cancelled || document.visibilityState !== "visible" || !navigator.onLine) return;
      const has = (p: string) => permissions.some((held) => held === p);
      const frontDesk = has(SNAPSHOT_SECTIONS.frontDesk);
      const list = { propertyId: property.id, limit: String(SNAPSHOT_LIST_LIMIT) };
      const once = { subscribe: false, forceRefetch: true } as const;
      try {
        const [summary, arrivals, inHouse, departures, board] = await Promise.all([
          frontDesk
            ? dispatch(frontDeskApi.endpoints.frontDeskSummary.initiate(property.id, once)).unwrap()
            : null,
          frontDesk
            ? dispatch(frontDeskApi.endpoints.arrivals.initiate(list, once)).unwrap()
            : null,
          frontDesk ? dispatch(frontDeskApi.endpoints.inHouse.initiate(list, once)).unwrap() : null,
          frontDesk
            ? dispatch(frontDeskApi.endpoints.departures.initiate(list, once)).unwrap()
            : null,
          has(SNAPSHOT_SECTIONS.rooms)
            ? dispatch(
                roomsApi.endpoints.roomBoardView.initiate({ propertyId: property.id }, once),
              ).unwrap()
            : null,
        ]);
        if (cancelled) return;
        const snapshot: OfflineSnapshot = {
          key,
          userId: me!.user.id,
          propertyId: property.id,
          propertyCode: property.code,
          propertyName: property.name,
          timezone: property.timezone,
          businessDate: summary?.businessDate ?? board?.businessDate ?? null,
          savedAt: Date.now(),
          permissions,
          arrivals: arrivals?.items.map(minimiseArrival) ?? null,
          inHouse: inHouse?.items.map(minimiseStay) ?? null,
          departures: departures?.items.map(minimiseStay) ?? null,
          rooms: board?.items.map(minimiseRoom) ?? null,
        };
        await saveSnapshot(snapshot);
      } catch {
        // Offline, signed out or forbidden: keep the previous snapshot; the
        // next successful load reconciles it with the session.
      }
    }

    async function start() {
      await claimSession({ id: me!.user.id, displayName: me!.user.displayName });
      await reconcileSnapshots({
        userId: me!.user.id,
        isSuperAdmin: me!.user.isSuperAdmin,
        properties: me!.properties,
      });
      if (permissions.length === 0) {
        await deleteSnapshots([key]);
        return;
      }
      const existing = (await listSnapshots()).find((s) => s.key === key);
      if (!existing || Date.now() - existing.savedAt > 60_000) await record();
    }

    void start();
    const timer = window.setInterval(() => void record(), SNAPSHOT_REFRESH_MS);
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const existing = (await listSnapshots()).find((s) => s.key === key);
      if (!existing || Date.now() - existing.savedAt > SNAPSHOT_REFRESH_MS) await record();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [me, property, dispatch]);

  return null;
}
