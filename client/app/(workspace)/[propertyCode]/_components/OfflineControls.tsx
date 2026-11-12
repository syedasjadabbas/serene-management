"use client";

import { ConnectivityStatus } from "@/global/components/offline/ConnectivityStatus";
import { OfflineSnapshotRecorder } from "@/global/components/offline/OfflineSnapshotRecorder";
import { useProperty } from "@/global/hooks/useProperty";
import { useMeQuery } from "@/global/api/endpoints/sessionApi";

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
