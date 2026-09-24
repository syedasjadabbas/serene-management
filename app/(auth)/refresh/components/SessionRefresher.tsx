"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect } from "react";
import { StatusPanel } from "@/components/ui/StatusPanel";

export function SessionRefresher({ next }: { next: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
      .then((response) => {
        if (cancelled) return;
        if (response.ok) {
          router.replace(next as Route);
          router.refresh();
        } else {
          router.replace(`/login?next=${encodeURIComponent(next)}` as Route);
        }
      })
      .catch(() => {
        if (!cancelled) router.replace(`/login?next=${encodeURIComponent(next)}` as Route);
      });
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  return <StatusPanel kind="loading" title="Restoring your session" />;
}
