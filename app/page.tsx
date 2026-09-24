import { redirect } from "next/navigation";
import type { Route } from "next";
import { getServerMe } from "@/lib/auth/session";

/** Entry point: send the user to their default property workspace. */
export default async function Home() {
  const me = await getServerMe();
  if (!me) redirect("/login");
  if (!me.defaultPropertyCode) redirect("/no-access");
  redirect(`/${me.defaultPropertyCode}` as Route);
}
