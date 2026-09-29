import type { Permission } from "@/lib/permissions/catalog";

export interface PropertySummary {
  id: string;
  code: string;
  name: string;
  timezone: string;
  currencyCode: string;
}

/** `GET /api/v1/me`: everything the UI needs to render and gate the workspace. */
export interface MeView {
  user: {
    id: string;
    email: string;
    displayName: string;
    locale: string;
    isSuperAdmin: boolean;
    /** Own profile picture (versioned URL), or null for initials. */
    avatarUrl: string | null;
  };
  organization: { id: string; code: string; name: string; baseCurrency: string };
  organizationPermissions: Permission[];
  properties: (PropertySummary & { permissions: Permission[] })[];
  defaultPropertyCode: string | null;
}
