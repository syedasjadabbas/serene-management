"use client";

import { GlobalSearch, type SearchSource } from "@/components/workspace/GlobalSearch";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";

/**
 * Global search for the current property: only the record types this user
 * may read here are searched (UI gating; every endpoint re-checks). Room
 * results open the room board with the room selected: housekeeping when
 * the user has it, otherwise the front desk's room view.
 */
export function PropertyGlobalSearch() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const base = `/${property.code}`;
  const roomHref = can("housekeeping:read")
    ? (roomId: string) => `${base}/housekeeping?room=${roomId}`
    : can("frontdesk:read")
      ? (roomId: string) => `${base}/front-desk?view=rooms&room=${roomId}`
      : null;
  const sources = (
    [
      ["reservations", can("reservations:read")],
      ["guests", can("guests:read")],
      ["rooms", can("rooms:read") && roomHref !== null],
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
      // Guests and companies open in this property: their sources are only
      // enabled when the user holds the matching permission here.
      profileCodes={{
        guests: can("guests:read") ? property.code : null,
        companies: can("accounts:read") ? property.code : null,
      }}
      openableCodes={[property.code]}
      sources={sources}
      roomHref={roomHref}
    />
  );
}
