"use client";

import { GlobalSearch, type SearchSource } from "@/components/workspace/GlobalSearch";
import { holdsAnywhere } from "@/components/workspace/sections";
import { useMeQuery } from "@/lib/api/endpoints/session.api";

/**
 * Global search in the organization workspace: the organization-level
 * profiles only (guests and companies). The server scopes them to the
 * user's access and resolves the property each type opens in (one the user
 * can access and holds that type's read permission in); without one the
 * results are shown as unavailable instead of linking anywhere.
 */
export function OrganizationGlobalSearch() {
  const { data: me } = useMeQuery();
  if (!me) return null;
  const sources: SearchSource[] = [
    ...(holdsAnywhere(me, "guests:read") ? (["guests"] as const) : []),
    ...(holdsAnywhere(me, "accounts:read") ? (["companies"] as const) : []),
  ];
  if (sources.length === 0) return null;
  return (
    <GlobalSearch
      property={null}
      openableCodes={me.properties.map((p) => p.code)}
      sources={sources}
    />
  );
}
