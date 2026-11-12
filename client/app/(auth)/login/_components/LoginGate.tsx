"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { type ReactNode, useEffect } from "react";
import { BrandLoader } from "@/global/components/brand/BrandLoader";
import { useAuthStore } from "@/global/stores/auth.store";

/**
 * The sign-in page is for signed-out users: when the boot refresh finds a
 * live session the user goes straight on to `next`. The form (and the
 * offline-data wipe that comes with it) renders only once the user is known
 * to be anonymous.
 */
export function LoginGate({ next, children }: { next: string; children: ReactNode }) {
  const router = useRouter();
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status === "authenticated") router.replace(next as Route);
  }, [status, next, router]);

  if (status === "anonymous") return <>{children}</>;
  return (
    <div className="py-10">
      <BrandLoader
        size="md"
        title={status === "booting" ? "Checking your session" : "Opening your workspace"}
      />
    </div>
  );
}
