"use client";

import { AuditHistory } from "@/components/audit/AuditHistory";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { useProperty } from "@/hooks/useProperty";
import { useFolioHistoryQuery } from "@/lib/api/endpoints/billing.api";
import { toClientApiError } from "@/lib/api/errors";

/** The financial audit trail of the stay's windows (audit:read). */
export function FolioHistory({ reservationRoomId }: { reservationRoomId: string }) {
  const property = useProperty();
  const query = useFolioHistoryQuery({ propertyId: property.id, reservationRoomId });
  const error = toClientApiError(query.error);
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading history" />;
  if (error) {
    return (
      <StatusPanel
        kind="error"
        title="Could not load the history"
        description={error.message}
        requestId={error.requestId}
      />
    );
  }
  return <AuditHistory entries={query.data ?? []} timezone={property.timezone} />;
}
