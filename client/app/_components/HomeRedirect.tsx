"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect } from "react";
import { SessionLoader } from "@/global/components/session/SessionLoader";
import { worksAcrossProperties } from "@/global/components/workspace/sections";
import { useMeQuery } from "@/global/api/endpoints/sessionApi";
import { useRequireAuth } from "@/global/hooks/useRequireAuth";

/**
 * Entry point: send the user to their default property workspace. An
 * organization-level user without any property yet (e.g. the administrator
 * right after `ops:bootstrap`) lands on Organization → Properties instead.
 */
export function HomeRedirect() {
  const router = useRouter();
  const status = useRequireAuth();
  const me = useMeQuery(undefined, { skip: status !== "authenticated" });

  useEffect(() => {
    if (!me.data) return;
    if (me.data.defaultPropertyCode) router.replace(`/${me.data.defaultPropertyCode}` as Route);
    else if (worksAcrossProperties(me.data)) router.replace("/organization/properties" as Route);
    else router.replace("/no-access");
  }, [me.data, router]);

  return <SessionLoader title="Opening your workspace" description="Just a moment." />;
}
