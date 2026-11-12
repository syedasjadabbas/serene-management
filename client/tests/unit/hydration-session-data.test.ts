import { type FunctionComponent, createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceNav } from "@/app/(workspace)/[propertyCode]/_components/WorkspaceNav";
import { UsersPanel } from "@/app/(workspace)/organization/users/_components/UsersPanel";
import { PropertyProvider } from "@/global/hooks/useProperty";
import { sessionApi } from "@/global/api/endpoints/sessionApi";
import { type AppStore, makeStore } from "@/global/api/store";
import { ALL_PERMISSIONS } from "@serene/shared/lib/permissions/catalog";
import type { MeView } from "@serene/shared/modules/access/access.types";

/**
 * React hydration error #418 (client-readiness audit): the server renders
 * these components with no session (/me has not been fetched there), but on
 * slow loads the shell has already fetched /me by the time their Suspense
 * boundary hydrates. Reading /me before hydration ended rendered extra markup
 * on the client ("More" in the navigation bar, "Add user" on Users & roles).
 *
 * renderToString uses the same pre-hydration snapshot as hydration
 * (useSyncExternalStore's getServerSnapshot, see hooks/useHydrated.ts), so a
 * render with /me already cached must equal a render without it.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/SMR",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const property = {
  id: "01a0d328-680a-7709-9d97-8ad9f5bad9c7",
  code: "SMR",
  name: "Serene Mountain Resort",
  timezone: "Asia/Karachi",
  currencyCode: "PKR",
};

const me: MeView = {
  user: {
    id: "u",
    email: "admin@serene.test",
    displayName: "Admin",
    locale: "en",
    isSuperAdmin: false,
    avatarUrl: null,
  },
  organization: { id: "o", code: "SERENE", name: "Serene Hospitality Group", baseCurrency: "PKR" },
  organizationPermissions: [...ALL_PERMISSIONS],
  properties: [{ ...property, permissions: [...ALL_PERMISSIONS] }],
  defaultPropertyCode: "SMR",
};

// Children passed as createElement arguments (react/no-children-prop): typed
// with optional children so the overload accepts them.
const Store = Provider as unknown as FunctionComponent<{ store: AppStore; children?: ReactNode }>;
const Property = PropertyProvider as unknown as FunctionComponent<{
  property: typeof property;
  children?: ReactNode;
}>;

async function render(node: ReactNode, withSession: boolean) {
  const store = makeStore();
  if (withSession) await store.dispatch(sessionApi.util.upsertQueryData("me", undefined, me));
  // The race being simulated: the session is in the cache before rendering.
  expect(sessionApi.endpoints.me.select()(store.getState()).data !== undefined).toBe(withSession);
  return renderToString(
    createElement(Store, { store }, createElement(Property, { property }, node)),
  );
}

describe("no session data before hydration ends (React #418)", () => {
  it("renders the property navigation bar the same with /me already cached", async () => {
    const server = await render(createElement(WorkspaceNav, { variant: "bar" }), false);
    const raced = await render(createElement(WorkspaceNav, { variant: "bar" }), true);
    expect(raced).toBe(server);
    expect(raced).not.toContain(">More<");
  });

  it("renders the mobile navigation panel the same with /me already cached", async () => {
    const server = await render(createElement(WorkspaceNav, { variant: "panel" }), false);
    expect(await render(createElement(WorkspaceNav, { variant: "panel" }), true)).toBe(server);
  });

  it("renders Users & roles the same with /me already cached (no early Add user)", async () => {
    const server = await render(createElement(UsersPanel), false);
    const raced = await render(createElement(UsersPanel), true);
    expect(raced).toBe(server);
    expect(raced).not.toContain("Add user");
  });
});
