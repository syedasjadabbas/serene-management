"use client";

import { GlobalSearch, type SearchSource } from "@/components/workspace/GlobalSearch";
import { profileTargetCode } from "@/components/workspace/searchTargets";
import { holdsAnywhere } from "@/components/workspace/sections";
import { useMeQuery } from "@/lib/api/endpoints/session.api";

/**
 * Global search in the organization workspace: the organization-level
 * profiles only (guests and companies; the API scopes them to the user's
 * access). Each record type opens in its own resolved property: one the
 * user can access and holds that type's read permission in (lowest code
 * when several qualify). Without such a property the results are shown as
 * unavailable instead of linking anywhere.
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
      profileCodes={{
        guests: profileTargetCode(me, "guests:read"),
        companies: profileTargetCode(me, "accounts:read"),
      }}
      openableCodes={me.properties.map((p) => p.code)}
      sources={sources}
      roomHref={null}
    />
  );
}
