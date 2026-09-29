import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { GuestsWorkspace } from "./components/GuestsWorkspace";

export const metadata: Metadata = { title: "Guests" };

export default function GuestsPage() {
  return (
    <Suspense fallback={<PageSkeleton title="Loading guests" />}>
      <GuestsWorkspace />
    </Suspense>
  );
}
