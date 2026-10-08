import { redirect } from "next/navigation";
import type { Route } from "next";
import { worksAcrossProperties } from "@/components/workspace/sections";
import { getServerMe } from "@/lib/auth/session";

/**
 * Entry point: send the user to their default property workspace. An
 * organization-level user without any property yet (e.g. the administrator
 * right after `ops:bootstrap`) lands on Organization → Properties instead.
 */
export default async function Home() {
  const me = await getServerMe();
  if (!me) redirect("/login");
  if (me.defaultPropertyCode) redirect(`/${me.defaultPropertyCode}` as Route);
  if (worksAcrossProperties(me)) redirect("/organization/properties" as Route);
  redirect("/no-access");
}
