import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemCatalog } from "./components/DesignSystemCatalog";

export const metadata: Metadata = { title: "Design system" };

/**
 * Living catalogue of the SERENE primitives (docs/DESIGN_SYSTEM.md), for
 * development and visual QA only: every state of every primitive on one
 * page, in both themes. Not served in production builds.
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSystemCatalog />;
}
