import type { ReactNode } from "react";
import { PropertyAccess } from "./_components/PropertyAccess";

/**
 * Property workspace frame. Access is resolved on the client from `/me`
 * (PropertyAccess): the Next.js server no longer holds a session.
 */
export default async function PropertyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ propertyCode: string }>;
}) {
  const { propertyCode } = await params;
  return <PropertyAccess propertyCode={propertyCode}>{children}</PropertyAccess>;
}
