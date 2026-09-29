"use client";

import { ConnectivityStatus } from "@/components/offline/ConnectivityStatus";
import { OfflineSnapshotRecorder } from "@/components/offline/OfflineSnapshotRecorder";
import { useProperty } from "@/hooks/useProperty";
import { useMeQuery } from "@/lib/api/endpoints/session.api";

/** The property workspace's offline support: header indicator plus the snapshot recorder. */
export function OfflineControls() {
  const property = useProperty();
  const { data: me } = useMeQuery();
  return (
    <>
      <OfflineSnapshotRecorder />
      <ConnectivityStatus propertyId={property.id} userId={me?.user.id ?? null} />
    </>
  );
}
