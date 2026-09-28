import type { Metadata } from "next";
import Link from "next/link";
import { StatusPanel } from "@/components/ui/StatusPanel";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main>
      <StatusPanel
        level={1}
        kind="empty"
        title="Page not found"
        description="The page does not exist or has moved."
        action={
          <Link className="text-sm text-brand hover:underline" href="/">
            Go to the workspace
          </Link>
        }
      />
    </main>
  );
}
