import { redirect } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PropertyProvider } from "@/hooks/useProperty";
import { getServerSession } from "@/lib/auth/session";
import { WorkspaceShell } from "./components/WorkspaceShell";

/**
 * Resolves /[propertyCode] against the properties the server granted this
 * user. A code the user cannot access renders "access denied" — the same
 * response whether or not the property exists.
 */
export default async function PropertyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ propertyCode: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { propertyCode } = await params;
  const requested = decodeURIComponent(propertyCode);
  const property = session.properties.find((p) => p.code === requested.toUpperCase());

  if (!property) {
    return (
      <StatusPanel
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
    );
  }
  if (property.code !== requested) redirect(`/${property.code}` as Route);

  return (
    <PropertyProvider property={property}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </PropertyProvider>
  );
}
