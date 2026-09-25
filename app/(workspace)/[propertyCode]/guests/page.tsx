import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { GuestsWorkspace } from "./components/GuestsWorkspace";

export const metadata: Metadata = { title: "Guests" };

export default function GuestsPage() {
  return (
    <Suspense fallback={<StatusPanel kind="loading" title="Loading guests" />}>
      <GuestsWorkspace />
    </Suspense>
  );
}
