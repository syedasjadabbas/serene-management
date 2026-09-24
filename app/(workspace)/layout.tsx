import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getServerSession } from "@/lib/auth/session";

/**
 * Authenticated area. proxy.ts only checked the token signature; this
 * re-validates the session against the database (revoked, disabled, expired).
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  if (!(await getServerSession())) redirect("/login");
  return <div className="min-h-screen bg-canvas">{children}</div>;
}
