"use client";

import { GlobalSearch, type SearchSource } from "@/components/workspace/GlobalSearch";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";

/**
 * Global search for the current property. The server searches only the
 * record types this user may read here (and decides where rooms open); the
 * same checks here decide whether the search is offered and what its hint
 * lists. Results open only in this property.
 */
export function PropertyGlobalSearch() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const sources = (
    [
      ["reservations", can("reservations:read")],
      ["guests", can("guests:read")],
      ["rooms", can("rooms:read") && (can("housekeeping:read") || can("frontdesk:read"))],
      ["folios", can("billing:read")],
      ["companies", can("accounts:read")],
      ["groups", can("groups:read")],
      ["maintenance", can("maintenance:read")],
      ["ratePlans", can("rates:read")],
    ] as [SearchSource, boolean][]
  )
    .filter(([, allowed]) => allowed)
    .map(([source]) => source);

  if (sources.length === 0) return null;
  return (
    <GlobalSearch
      property={{ id: property.id, code: property.code }}
      openableCodes={[property.code]}
      sources={sources}
    />
  );
}
