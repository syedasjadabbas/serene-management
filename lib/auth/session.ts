import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { type ResolvedSession, resolveSession, toMeView } from "@/modules/access/access.service";
import type { MeView } from "@/modules/access/access.types";
import { ACCESS_COOKIE } from "./cookies";
import { verifyAccessToken } from "./tokens";

/**
 * Session for Server Components (layouts, pages). Deduplicated per request
 * with React `cache`. Route handlers use `defineRoute` instead; this helper
 * never authorizes API access.
 */
export const getServerSession = cache(async (): Promise<ResolvedSession | null> => {
  const store = await cookies();
  const claims = await verifyAccessToken(store.get(ACCESS_COOKIE)?.value);
  return claims ? resolveSession(claims) : null;
});

/** The `GET /me` view for Server Components (e.g. choosing the default property). */
export async function getServerMe(): Promise<MeView | null> {
  const session = await getServerSession();
  return session ? toMeView(session) : null;
}
