"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect } from "react";
import { type AuthStatus, useAuthStore } from "@/global/stores/auth.store";

/**
 * Client-side route guard: once the boot refresh finds no session (or the
 * server ends it), replaces the page with `/login?next=<here>&reason=<code>`.
 * A deliberate sign-out goes to a plain `/login`. Returns the auth status so
 * the caller renders nothing sensitive until it is "authenticated".
 */
export function useRequireAuth(): AuthStatus {
  const status = useAuthStore((state) => state.status);
  const endedBy = useAuthStore((state) => state.endedBy);
  const deliberate = useAuthStore((state) => state.deliberate);
  const router = useRouter();

  useEffect(() => {
    if (status !== "anonymous") return;
    const params = new URLSearchParams();
    const here = `${window.location.pathname}${window.location.search}`;
    if (!deliberate) {
      if (here !== "/") params.set("next", here);
      if (endedBy) params.set("reason", endedBy.code);
    }
    const query = params.toString();
    router.replace((query ? `/login?${query}` : "/login") as Route);
  }, [status, endedBy, deliberate, router]);

  return status;
}
