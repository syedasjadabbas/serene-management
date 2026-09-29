import type { Metadata } from "next";
import { OfflineView } from "./components/OfflineView";

export const metadata: Metadata = { title: "Offline mode" };

/**
 * The offline shell (docs/OFFLINE_ARCHITECTURE.md §L). Public and free of
 * server data on purpose: the service worker caches this page's HTML and
 * serves it for any navigation that fails without a network. Everything it
 * shows comes from this browser's offline store, read on the client and
 * limited to the user who last signed in here.
 */
export default function OfflinePage() {
  return <OfflineView />;
}
