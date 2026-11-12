import type { ReactNode } from "react";
import { WorkspaceAuthGuard } from "./_components/WorkspaceAuthGuard";

/** Authenticated area: the client auth guard (booting → /me → shell, or redirect to /login). */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceAuthGuard>{children}</WorkspaceAuthGuard>;
}
