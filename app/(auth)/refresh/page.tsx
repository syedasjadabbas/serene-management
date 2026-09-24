import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/redirect";
import { SessionRefresher } from "./components/SessionRefresher";

export const metadata: Metadata = { title: "Restoring session" };

/** Reached from proxy.ts when the access token expired but a session may still exist. */
export default async function RefreshPage({ searchParams }: PageProps<"/refresh">) {
  const params = await searchParams;
  return (
    <SessionRefresher next={safeNextPath(typeof params.next === "string" ? params.next : null)} />
  );
}
