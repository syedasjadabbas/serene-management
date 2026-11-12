"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { type ReactNode, useEffect } from "react";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { useMeQuery } from "@/global/api/endpoints/sessionApi";
import { PropertyProvider } from "@/global/hooks/useProperty";
import { WorkspaceShell } from "./WorkspaceShell";

/**
 * Resolves /[propertyCode] against the properties the server granted this
 * user (from `/me`, loaded by the workspace guard). The code is matched
 * case-insensitively and the URL is canonicalised. A code the user cannot
 * access renders "access denied", the same whether or not the property exists.
 */
export function PropertyAccess({
  propertyCode,
  children,
}: {
  propertyCode: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { data: me } = useMeQuery();
  const requested = decodeURIComponent(propertyCode);
  const property = me?.properties.find((p) => p.code === requested.toUpperCase());
  const canonical = property !== undefined && property.code !== requested;

  useEffect(() => {
    if (property && canonical) router.replace(`/${property.code}` as Route);
  }, [property, canonical, router]);

  if (!me) return <LoadingProperty />;
  if (!property) {
    return (
      <main id="main">
        <StatusPanel
          level={1}
          kind="forbidden"
          title="Access denied"
          description="You do not have access to this property, or it does not exist."
          action={
            <Link
              href="/"
              className="text-sm font-medium text-brand underline-offset-2 hover:underline"
            >
              Go to your properties
            </Link>
          }
        />
      </main>
    );
  }
  if (canonical) return <LoadingProperty />;

  return (
    <PropertyProvider
      property={{
        id: property.id,
        code: property.code,
        name: property.name,
        timezone: property.timezone,
        currencyCode: property.currencyCode,
      }}
    >
      <WorkspaceShell>{children}</WorkspaceShell>
    </PropertyProvider>
  );
}

function LoadingProperty() {
  return (
    <main id="main">
      <StatusPanel level={1} kind="loading" title="Loading property" />
    </main>
  );
}
